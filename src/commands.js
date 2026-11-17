// Employee-facing commands. `store` is the db store from src/db.js.
const { Markup } = require('telegraf');
const { todayDate, nowTime, isLate, hoursWorked, formatHours } = require('./logic');

const LATE_AFTER = () => process.env.LATE_AFTER || '09:30';

function displayName(ctx) {
  return [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || `User ${ctx.from.id}`;
}

function ensureRegistered(ctx, store) {
  let emp = store.getEmployee(ctx.from.id);
  if (!emp) emp = store.registerEmployee(ctx.from.id, displayName(ctx));
  return emp;
}

function recordLine(r, showLocation = false) {
  if (!r) return 'No record.';
  const late = r.check_in && isLate(r.check_in, LATE_AFTER()) ? ' (late)' : '';
  const hours = hoursWorked(r.check_in, r.check_out);
  let line = `${r.date}: in ${r.check_in || '—'}${late} · out ${r.check_out || '—'} · worked ${formatHours(hours)}`;
  if (showLocation && r.check_in_lat != null) line += ` · 📍 ${r.check_in_lat.toFixed(5)}, ${r.check_in_lon.toFixed(5)}`;
  return line;
}

const HELP = `Attendance bot — commands:
/start — register & show this help
/checkin — check in (share your location as proof)
/checkout — check out
/status — am I in or out right now?
/today — my record for today
/history — my last 7 days
/leave <reason> — request leave

Admins also have: /employees /report /report_week /leaves /approve <telegram_id> /add_admin <telegram_id>`;

function registerUserCommands(bot, store) {
  bot.start((ctx) => {
    const emp = ensureRegistered(ctx, store);
    return ctx.reply(`Welcome, ${emp.name}! You're registered for attendance.\n\n${HELP}`);
  });

  bot.help((ctx) => ctx.reply(HELP));

  // /checkin — if no location yet, ask for it with a one-tap button.
  bot.command('checkin', async (ctx) => {
    ensureRegistered(ctx, store);
    const res = store.checkIn(ctx.from.id);
    if (!res.ok) return ctx.reply(`You're already checked in today at ${res.record.check_in}.`);
    const late = isLate(res.record.check_in, LATE_AFTER()) ? ` You're late (after ${LATE_AFTER()}).` : '';
    return ctx.reply(
      `✅ Checked in at ${res.record.check_in}.${late}\nWant to attach your location as proof? Send your location now, or ignore this.`,
      Markup.keyboard([[Markup.button.locationRequest('📍 Share my location')]]).oneTime().resize()
    );
  });

  // A location message counts as check-in proof: if already in today, attach
  // the coordinates to today's record; otherwise check in with the location.
  bot.on('location', async (ctx) => {
    ensureRegistered(ctx, store);
    const { latitude, longitude } = ctx.message.location;
    const today = store.getToday(ctx.from.id);
    if (today && today.check_in) {
      store.checkIn(ctx.from.id, { lat: latitude, lon: longitude });
      return ctx.reply(`📍 Location saved for today's check-in (${today.check_in}).`);
    }
    const res = store.checkIn(ctx.from.id, { lat: latitude, lon: longitude });
    const late = isLate(res.record.check_in, LATE_AFTER()) ? ` You're late (after ${LATE_AFTER()}).` : '';
    return ctx.reply(`✅ Checked in at ${res.record.check_in} with location.${late}`);
  });

  bot.command('checkout', async (ctx) => {
    ensureRegistered(ctx, store);
    const res = store.checkOut(ctx.from.id);
    if (!res.ok && res.reason === 'no_checkin') return ctx.reply("You haven't checked in today — /checkin first.");
    if (!res.ok && res.reason === 'already_out') return ctx.reply(`You already checked out today at ${res.record.check_out}.`);
    const hours = hoursWorked(res.record.check_in, res.record.check_out);
    return ctx.reply(`👋 Checked out at ${res.record.check_out}. Hours worked today: ${formatHours(hours)}.`, Markup.removeKeyboard());
  });

  bot.command('status', async (ctx) => {
    ensureRegistered(ctx, store);
    const r = store.getToday(ctx.from.id);
    if (!r || !r.check_in) return ctx.reply('You are not checked in today. Use /checkin.');
    if (r.check_out) return ctx.reply(`You checked out at ${r.check_out} (in ${r.check_in}). Hours worked: ${formatHours(hoursWorked(r.check_in, r.check_out))}.`);
    const soFar = hoursWorked(r.check_in, nowTime());
    return ctx.reply(`You're checked in since ${r.check_in}. So far today: ${formatHours(soFar)}.`);
  });

  bot.command('today', async (ctx) => {
    ensureRegistered(ctx, store);
    const r = store.getToday(ctx.from.id);
    return ctx.reply(`Today (${todayDate()}):\n${recordLine(r, true)}`);
  });

  bot.command('history', async (ctx) => {
    ensureRegistered(ctx, store);
    const rows = store.getHistory(ctx.from.id, 7);
    if (!rows.length) return ctx.reply('No attendance records yet.');
    return ctx.reply(`Last ${rows.length} day(s):\n` + rows.map((r) => recordLine(r)).join('\n'));
  });

  bot.command('leave', async (ctx) => {
    ensureRegistered(ctx, store);
    const reason = ctx.message.text.replace(/^\/leave(@\w+)?\s*/, '').trim();
    if (!reason) return ctx.reply('Usage: /leave <reason> — e.g. /leave sick day');
    const req = store.requestLeave(ctx.from.id, reason);
    return ctx.reply(`📝 Leave request #${req.id} recorded for ${req.date} (${reason}). Status: pending approval.`);
  });
}

module.exports = { registerUserCommands, HELP };
