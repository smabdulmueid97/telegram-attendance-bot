// Bot wiring: Telegraf + Express. Webhook when WEBHOOK_URL is set, long polling otherwise.
require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const { openDb, createStore } = require('./db');
const { registerUserCommands } = require('./commands');
const { registerAdminCommands } = require('./admin');

function createBot(store) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is missing — copy .env.example to .env and add your BotFather token.');
  const bot = new Telegraf(token);
  registerUserCommands(bot, store);
  registerAdminCommands(bot, store);
  bot.catch((err) => console.error('Bot error:', err));
  return bot;
}

async function main() {
  // Fail fast before touching the database when no token is configured.
  if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is missing — copy .env.example to .env and add your BotFather token.');
  const store = createStore(openDb());
  const bot = createBot(store);
  const app = express();
  app.use(express.json());

  const port = Number(process.env.PORT || 3000);
  const webhookUrl = (process.env.WEBHOOK_URL || '').replace(/\/$/, '');

  app.get('/health', (_req, res) => res.json({ ok: true }));

  if (webhookUrl) {
    // Webhook mode (Render / Railway / any host): Telegram POSTs to /telegram/<token>.
    const path = `/telegram/${bot.token}`;
    app.use(bot.webhookCallback(path));
    app.listen(port, async () => {
      await bot.telegram.setWebhook(`${webhookUrl}${path}`);
      console.log(`Webhook set: ${webhookUrl}${path} (port ${port})`);
    });
  } else {
    // Long-polling mode (local dev / a plain server).
    app.listen(port, () => console.log(`Health check on :${port}/health — bot running with long polling`));
    await bot.launch();
    console.log('Bot started (long polling).');
  }

  const stop = (signal) => {
    console.log(`Received ${signal}, stopping…`);
    bot.stop(signal);
    process.exit(0);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

module.exports = { createBot, main };
