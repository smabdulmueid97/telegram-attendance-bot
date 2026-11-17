// SQLite storage (node:sqlite, built into Node 22.5+ — no native build step).
// One file: attendance.db in the project root (or DB_PATH in .env).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { todayDate, nowTime, isLate, hoursWorked } = require('./logic');

function openDb(dbPath) {
  const file = dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'attendance.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      telegram_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      joined_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admins (
      telegram_id INTEGER PRIMARY KEY,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      check_in TEXT,
      check_out TEXT,
      check_in_lat REAL,
      check_in_lon REAL,
      UNIQUE (telegram_id, date),
      FOREIGN KEY (telegram_id) REFERENCES employees (telegram_id)
    );
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decided_at TEXT,
      FOREIGN KEY (telegram_id) REFERENCES employees (telegram_id)
    );
  `);
  return db;
}

function createStore(db) {
  const q = (sql) => db.prepare(sql);

  return {
    // --- employees ---
    registerEmployee(telegramId, name) {
      const now = new Date().toISOString();
      q('INSERT OR IGNORE INTO employees (telegram_id, name, joined_at) VALUES (?, ?, ?)').run(telegramId, name, now);
      return this.getEmployee(telegramId);
    },
    getEmployee(telegramId) {
      return q('SELECT * FROM employees WHERE telegram_id = ?').get(telegramId) || null;
    },
    listEmployees() {
      return q('SELECT * FROM employees ORDER BY name').all();
    },

    // --- admins (extra admins added at runtime, on top of ADMIN_IDS in .env) ---
    addAdmin(telegramId) {
      q('INSERT OR IGNORE INTO admins (telegram_id, added_at) VALUES (?, ?)').run(telegramId, new Date().toISOString());
    },
    isDbAdmin(telegramId) {
      return !!q('SELECT 1 FROM admins WHERE telegram_id = ?').get(telegramId);
    },

    // --- attendance ---
    // Returns { ok, alreadyIn, record } — one check-in per day.
    checkIn(telegramId, { lat = null, lon = null, date = todayDate(), time = nowTime() } = {}) {
      const existing = q('SELECT * FROM attendance WHERE telegram_id = ? AND date = ?').get(telegramId, date);
      if (existing && existing.check_in) return { ok: false, alreadyIn: true, record: existing };
      if (existing) {
        q('UPDATE attendance SET check_in = ?, check_in_lat = ?, check_in_lon = ? WHERE id = ?').run(time, lat, lon, existing.id);
      } else {
        q('INSERT INTO attendance (telegram_id, date, check_in, check_in_lat, check_in_lon) VALUES (?, ?, ?, ?, ?)').run(telegramId, date, time, lat, lon);
      }
      return { ok: true, record: this.getToday(telegramId, date) };
    },

    // Returns { ok, reason, record } — reason: 'no_checkin' | 'already_out'.
    checkOut(telegramId, { date = todayDate(), time = nowTime() } = {}) {
      const existing = q('SELECT * FROM attendance WHERE telegram_id = ? AND date = ?').get(telegramId, date);
      if (!existing || !existing.check_in) return { ok: false, reason: 'no_checkin', record: existing || null };
      if (existing.check_out) return { ok: false, reason: 'already_out', record: existing };
      q('UPDATE attendance SET check_out = ? WHERE id = ?').run(time, existing.id);
      return { ok: true, record: this.getToday(telegramId, date) };
    },

    getToday(telegramId, date = todayDate()) {
      return q('SELECT * FROM attendance WHERE telegram_id = ? AND date = ?').get(telegramId, date) || null;
    },

    getHistory(telegramId, days = 7) {
      return q('SELECT * FROM attendance WHERE telegram_id = ? ORDER BY date DESC LIMIT ?').all(telegramId, days);
    },

    // --- reports ---
    todayReport(date = todayDate()) {
      const employees = this.listEmployees();
      const rows = q('SELECT * FROM attendance WHERE date = ?').all(date);
      const byId = new Map(rows.map((r) => [r.telegram_id, r]));
      return employees.map((e) => ({ employee: e, record: byId.get(e.telegram_id) || null }));
    },

    weekReport(days = 7) {
      const employees = this.listEmployees();
      const rows = q('SELECT * FROM attendance ORDER BY date DESC LIMIT ?').all(days * Math.max(employees.length, 1));
      const lateAfter = process.env.LATE_AFTER || '09:30';
      return employees.map((e) => {
        const mine = rows.filter((r) => r.telegram_id === e.telegram_id);
        const present = mine.filter((r) => r.check_in).length;
        const late = mine.filter((r) => r.check_in && isLate(r.check_in, lateAfter)).length;
        const totalHours = mine.reduce((s, r) => s + (hoursWorked(r.check_in, r.check_out) || 0), 0);
        return { employee: e, present, late, totalHours: Math.round(totalHours * 100) / 100 };
      });
    },

    // --- leave ---
    requestLeave(telegramId, reason, date = todayDate()) {
      const r = q('INSERT INTO leave_requests (telegram_id, date, reason) VALUES (?, ?, ?)').run(telegramId, date, reason);
      return q('SELECT * FROM leave_requests WHERE id = ?').get(r.lastInsertRowid);
    },
    listPendingLeave() {
      return q(`SELECT l.*, e.name FROM leave_requests l
                JOIN employees e ON e.telegram_id = l.telegram_id
                WHERE l.status = 'pending' ORDER BY l.date DESC`).all();
    },
    // Approves the latest pending request for that user. Returns the request or null.
    approveLeave(telegramId) {
      const req = q(`SELECT * FROM leave_requests WHERE telegram_id = ? AND status = 'pending'
                    ORDER BY id DESC LIMIT 1`).get(telegramId);
      if (!req) return null;
      q(`UPDATE leave_requests SET status = 'approved', decided_at = ? WHERE id = ?`).run(new Date().toISOString(), req.id);
      return { ...req, status: 'approved' };
    },
  };
}

module.exports = { openDb, createStore };
