// Admin commands. Restricted to ADMIN_IDS in .env plus admins added via /add_admin.
const { isLate, hoursWorked, formatHours } = require('./logic');

function envAdminIds() {
  return (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

function isAdmin(ctx, store) {
  return envAdminIds().includes(ctx.from.id) || store.isDbAdmin(ctx.from.id);
}

function adminOnly(bot, store) {
  // Guard: run before every admin command.
  return (ctx, next) => {
    if (!isAdmin(ctx, store)) return ctx.reply('This command is for admins only.');
    return next();
  };
}

function registerAdminCommands(bot, store) {
  const guard = adminOnly(bot, store);

  bot.command('employees', guard, async (ctx) => {
    const list = store.listEmployees();
    if (!list.length) return ctx.reply('No employees registered yet.');
    return ctx.reply(`Employees (${list.length}):\n` + list.map((e) => `• ${e.name} — ${e.telegram_id} (since ${e.joined_at.slice(0, 10)})`).join('\n'));
  });

  bot.command('report', guard, async (ctx) => {
    const lateAfter = process.env.LATE_AFTER || '09:30';
    const rows = store.todayReport();
    if (!rows.length) return ctx.reply('No employees registered yet.');
    const lines = rows.map(({ employee, record }) => {
      if (!record || !record.check_in) return `❌ ${employee.name} — absent`;
      const late = isLate(record.check_in, lateAfter) ? ' (late)' : '';
      const out = record.check_out ? ` → out ${record.check_out} (${formatHours(hoursWorked(record.check_in, record.check_out))})` : ' — still in';
      return `✅ ${employee.name} — in ${record.check_in}${late}${out}`;
    });
    return ctx.reply(`Today's attendance:\n` + lines.join('\n'));
  });

  bot.command('report_week', guard, async (ctx) => {
    const rows = store.weekReport(7);
    if (!rows.length) return ctx.reply('No employees registered yet.');
    const lines = rows.map(({ employee, present, late, totalHours }) =>
      `• ${employee.name}: ${present}/7 days, ${late} late, ${formatHours(totalHours)} total`);
    return ctx.reply(`Last 7 days:\n` + lines.join('\n'));
  });

  bot.command('leaves', guard, async (ctx) => {
    const pending = store.listPendingLeave();
    if (!pending.length) return ctx.reply('No pending leave requests.');
    return ctx.reply(`Pending leave:\n` + pending.map((l) => `#${l.id} ${l.name} (${l.telegram_id}) — ${l.date}: ${l.reason}`).join('\n'));
  });

  bot.command('approve', guard, async (ctx) => {
    const arg = ctx.message.text.split(/\s+/)[1];
    const userId = Number(arg);
    if (!userId) return ctx.reply('Usage: /approve <telegram_id> — see /leaves for pending requests.');
    const req = store.approveLeave(userId);
    if (!req) return ctx.reply(`No pending leave request for ${userId}.`);
    return ctx.reply(`✅ Leave #${req.id} for ${userId} approved (${req.date}: ${req.reason}).`);
  });

  bot.command('add_admin', guard, async (ctx) => {
    const arg = ctx.message.text.split(/\s+/)[1];
    const userId = Number(arg);
    if (!userId) return ctx.reply('Usage: /add_admin <telegram_id>');
    store.addAdmin(userId);
    return ctx.reply(`✅ ${userId} is now an admin.`);
  });
}

module.exports = { registerAdminCommands, isAdmin, envAdminIds };
