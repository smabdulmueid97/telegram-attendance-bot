// Pure time/date + late/hours rules. No Telegram, no database needed.

function pad(n) {
  return String(n).padStart(2, '0');
}

// Local date as YYYY-MM-DD (server timezone).
function todayDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local time as HH:MM (server timezone).
function nowTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Late if check-in time is after LATE_AFTER ("HH:MM", default "09:30").
// Exactly on the cutoff is on time.
function isLate(checkInTime, lateAfter = '09:30') {
  if (!checkInTime) return false;
  return timeToMinutes(checkInTime) > timeToMinutes(lateAfter);
}

// Hours worked between check-in and check-out ("HH:MM"), rounded to 2 decimals.
// Returns null when either time is missing, 0 when checkout is not after check-in.
function hoursWorked(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const mins = timeToMinutes(checkOut) - timeToMinutes(checkIn);
  if (mins <= 0) return 0;
  return Math.round((mins / 60) * 100) / 100;
}

function formatHours(hours) {
  if (hours === null || hours === undefined) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${pad(m)}m`;
}

module.exports = { todayDate, nowTime, timeToMinutes, isLate, hoursWorked, formatHours };
