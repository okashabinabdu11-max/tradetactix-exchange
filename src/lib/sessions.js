// Trading-session clock, worked out from the real current time.
// These are the typical session hours traders refer to, not a broker's
// official schedule. Exness's own hours will be read from MT5 later.

export const SESSIONS = [
  { id: 'tokyo', name: 'Tokyo', timeZone: 'Asia/Tokyo', openHour: 9, closeHour: 18 },
  { id: 'london', name: 'London', timeZone: 'Europe/London', openHour: 8, closeHour: 17 },
  { id: 'newyork', name: 'New York', timeZone: 'America/New_York', openHour: 8, closeHour: 17 },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local weekday (0 = Sunday), hour and minute for a time zone. */
// Building a formatter is slow, so one is kept per time zone.
const FORMATTERS = new Map();
function formatterFor(timeZone) {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

export function localParts(date, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    weekday: WEEKDAYS.indexOf(get('weekday')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/**
 * Spot gold typically trades from Sunday 18:00 to Friday 17:00 New York time,
 * with a one-hour pause each day at 17:00.
 */
const OPEN_CACHE = new Map(); // by minute; the answer only changes on the hour
export function isGoldMarketOpen(date) {
  const key = Math.floor(date.getTime() / 60e3);
  const hit = OPEN_CACHE.get(key);
  if (hit !== undefined) return hit;
  const { weekday, hour } = localParts(date, 'America/New_York');
  const open = weekday === 6 ? false : weekday === 0 ? hour >= 18 : weekday === 5 ? hour < 17 : hour !== 17;
  if (OPEN_CACHE.size > 50000) OPEN_CACHE.clear();
  OPEN_CACHE.set(key, open);
  return open;
}

export function sessionStatus(date = new Date()) {
  const marketOpen = isGoldMarketOpen(date);
  const sessions = SESSIONS.map((s) => {
    const { weekday, hour, minute } = localParts(date, s.timeZone);
    const inHours = weekday >= 1 && weekday <= 5 && hour >= s.openHour && hour < s.closeHour;
    return {
      ...s,
      localTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      open: marketOpen && inHours,
    };
  });
  const openNames = sessions.filter((s) => s.open).map((s) => s.name);
  return {
    marketOpen,
    sessions,
    overlap: openNames.length > 1 ? openNames.join(' and ') : null,
  };
}
