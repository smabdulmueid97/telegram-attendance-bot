# Telegram Attendance Bot

A standalone Telegram bot for company attendance. Employees check in and out
in Telegram; admins get daily and weekly reports. No company name is baked
in — it works for any company.

## What it does

| Who | Commands |
| --- | --- |
| Everyone | `/start` register & help, `/checkin`, `/checkout`, `/status`, `/today`, `/history`, `/leave <reason>` |
| Admins | `/employees`, `/report`, `/report_week`, `/leaves`, `/approve <telegram_id>`, `/add_admin <telegram_id>` |

Rules:

- One check-in per day. A second `/checkin` tells you you're already in.
- Checkout only works after a check-in.
- Check-in after `LATE_AFTER` (default `09:30`) counts as late.
- Hours worked are computed on checkout.
- `/checkin` offers a one-tap location share; sending a location also counts
  as check-in proof (latitude/longitude stored with the record).
- Leave requests are stored as pending until an admin approves them.

Data is stored in a single SQLite file (`attendance.db`) using Node's built-in
`node:sqlite` — no native build step, no extra database server.

## Setup

1. Talk to **@BotFather** on Telegram, create a bot (`/newbot`), copy the token.
2. Find your own Telegram user ID (e.g. via **@userinfobot**) — that is an admin ID.
3. Install and configure:

```bash
npm install
cp .env.example .env
# edit .env: BOT_TOKEN, ADMIN_IDS
npm start
```

4. Open your bot in Telegram and send `/start`.

Requires **Node.js 22.5+** (uses built-in `node:sqlite`).

## Configuration (.env)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `BOT_TOKEN` | yes | — | From @BotFather |
| `ADMIN_IDS` | yes | — | Comma-separated Telegram user IDs |
| `LATE_AFTER` | no | `09:30` | `HH:MM`, 24-hour |
| `WEBHOOK_URL` | no | — | Public URL, e.g. `https://my-bot.onrender.com`. Leave empty for long polling |
| `PORT` | no | `3000` | Health-check server (`/health`) |
| `DB_PATH` | no | `./attendance.db` | SQLite file |

## Deploy

**Long polling (simplest):** run `npm start` on any server that stays online
(a VPS, a spare machine). Leave `WEBHOOK_URL` empty.

**Webhook (Render / Railway):** set `WEBHOOK_URL` to the service's public URL,
deploy with start command `npm start`. The bot sets its webhook to
`<WEBHOOK_URL>/telegram/<token>` on startup. The `/health` endpoint is there
for the host's health check.

## Commands in detail

- `/start` — registers you as an employee and shows the help text.
- `/checkin` — checks you in at the current time. Offers a location-share
  button; sending your location attaches it to today's record.
- `/checkout` — checks you out and reports hours worked today.
- `/status` — are you in or out right now, and hours so far.
- `/today` — your record for today (in/out times, late flag, location).
- `/history` — your last 7 days.
- `/leave <reason>` — e.g. `/leave sick day`. Stored as pending.
- `/employees` (admin) — all registered employees with Telegram IDs.
- `/report` (admin) — today: who is in, who is late, who is absent.
- `/report_week` (admin) — last 7 days per employee: days present, late count, total hours.
- `/leaves` (admin) — pending leave requests.
- `/approve <telegram_id>` (admin) — approve that user's latest pending leave.
- `/add_admin <telegram_id>` (admin) — grant admin rights (stored in the DB,
  on top of `ADMIN_IDS` in `.env`).

## Tests

```bash
npm test
```

Runs the core logic (check-in/check-out/late/hours/leave/reports) against a
temporary SQLite database — no Telegram token or network needed.

## Project layout

```
package.json
.env.example
src/
  index.js     entry point (calls bot.main)
  bot.js       Telegraf + Express wiring, webhook vs long polling
  commands.js  employee commands
  admin.js     admin commands + admin check
  db.js        SQLite store (employees, attendance, leave_requests, admins)
  logic.js     pure date/time/late/hours rules
test/
  test.js      core-logic tests (temp DB, PASS/FAIL output)
```

## License

MIT — see `LICENSE`.
