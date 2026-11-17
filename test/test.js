// Core-logic tests — no Telegram token, no network.
// Exercises check-in / check-out / late / hours / leave against a temp SQLite DB.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { isLate, hoursWorked, formatHours, todayDate } = require('../src/logic');
const { openDb, createStore } = require('../src/db');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

// --- pure logic ---
check('on time at exactly 09:30 is not late', () => assert.strictEqual(isLate('09:30', '09:30'), false));
check('09:31 is late', () => assert.strictEqual(isLate('09:31', '09:30'), true));
check('08:00 is not late', () => assert.strictEqual(isLate('08:00', '09:30'), false));
check('custom cutoff 10:00: 09:45 not late, 10:01 late', () => {
  assert.strictEqual(isLate('09:45', '10:00'), false);
  assert.strictEqual(isLate('10:01', '10:00'), true);
});
check('hours 09:00 -> 17:30 = 8.5', () => assert.strictEqual(hoursWorked('09:00', '17:30'), 8.5));
check('hours missing checkout = null', () => assert.strictEqual(hoursWorked('09:00', null), null));
check('hours checkout before check-in = 0', () => assert.strictEqual(hoursWorked('17:00', '09:00'), 0));
check('formatHours 8.5 = "8h 30m"', () => assert.strictEqual(formatHours(8.5), '8h 30m'));
check('formatHours null = "—"', () => assert.strictEqual(formatHours(null), '—'));

// --- store, on a temp DB ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'att-test-'));
const dbPath = path.join(tmp, 'test.db');
const store = createStore(openDb(dbPath));

check('register employee + getEmployee', () => {
  const e = store.registerEmployee(111, 'Test User');
  assert.strictEqual(e.telegram_id, 111);
  assert.strictEqual(e.name, 'Test User');
  assert.strictEqual(store.getEmployee(111).name, 'Test User');
});

check('check-in once, second check-in refused (already in)', () => {
  const first = store.checkIn(111, { date: '2026-11-16', time: '09:00' });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.record.check_in, '09:00');
  const second = store.checkIn(111, { date: '2026-11-16', time: '09:05' });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.alreadyIn, true);
  assert.strictEqual(second.record.check_in, '09:00');
});

check('checkout only after check-in; hours computed', () => {
  const noIn = store.checkOut(999, { date: '2026-11-16', time: '17:00' });
  assert.strictEqual(noIn.ok, false);
  assert.strictEqual(noIn.reason, 'no_checkin');
  const out = store.checkOut(111, { date: '2026-11-16', time: '17:30' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.record.check_out, '17:30');
  assert.strictEqual(hoursWorked(out.record.check_in, out.record.check_out), 8.5);
  const again = store.checkOut(111, { date: '2026-11-16', time: '18:00' });
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.reason, 'already_out');
});

check('location stored on check-in', () => {
  store.registerEmployee(222, 'Loc User');
  const r = store.checkIn(222, { date: '2026-11-16', time: '08:45', lat: 23.8103, lon: 90.4125 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.check_in_lat, 23.8103);
  assert.strictEqual(r.record.check_in_lon, 90.4125);
});

check('late check-in flagged in today report', () => {
  store.registerEmployee(333, 'Late User');
  store.checkIn(333, { date: '2026-11-16', time: '10:15' });
  store.registerEmployee(444, 'Absent User');
  const report = store.todayReport('2026-11-16');
  const late = report.find((x) => x.employee.telegram_id === 333);
  assert.strictEqual(isLate(late.record.check_in, '09:30'), true);
  const absent = report.find((x) => x.employee.telegram_id === 444);
  assert.strictEqual(absent.record, null);
});

check('history returns last 7 days, newest first', () => {
  const rows = store.getHistory(111, 7);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].date, '2026-11-16');
});

check('leave request pending, then approved', () => {
  const req = store.requestLeave(111, 'sick day', '2026-11-17');
  assert.strictEqual(req.status, 'pending');
  assert.strictEqual(store.listPendingLeave().length, 1);
  const approved = store.approveLeave(111);
  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(store.listPendingLeave().length, 0);
  assert.strictEqual(store.approveLeave(111), null); // nothing left to approve
});

check('week report counts present / late / total hours', () => {
  const week = store.weekReport(7);
  const u111 = week.find((x) => x.employee.telegram_id === 111);
  assert.strictEqual(u111.present, 1);
  assert.strictEqual(u111.late, 0);
  assert.strictEqual(u111.totalHours, 8.5);
  const u333 = week.find((x) => x.employee.telegram_id === 333);
  assert.strictEqual(u333.late, 1);
});

check('runtime admins: add_admin then isDbAdmin', () => {
  assert.strictEqual(store.isDbAdmin(555), false);
  store.addAdmin(555);
  assert.strictEqual(store.isDbAdmin(555), true);
});

check('todayDate returns YYYY-MM-DD', () => {
  assert.match(todayDate(), /^\d{4}-\d{2}-\d{2}$/);
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
