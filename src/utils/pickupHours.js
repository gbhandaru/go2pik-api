const DEFAULT_TIMEZONE = 'America/Los_Angeles';

const DEFAULT_WEEKLY_SCHEDULE = {
  monday: [{ open: '10:00', close: '21:00' }],
  tuesday: [{ open: '10:00', close: '21:00' }],
  wednesday: [{ open: '10:00', close: '21:00' }],
  thursday: [{ open: '10:00', close: '21:00' }],
  friday: [{ open: '10:00', close: '22:00' }],
  saturday: [{ open: '10:00', close: '22:00' }],
  sunday: [{ open: '11:00', close: '20:00' }],
};

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ALIASES = new Map(
  [
    ['sun', 'sunday'],
    ['sunday', 'sunday'],
    ['mon', 'monday'],
    ['monday', 'monday'],
    ['tue', 'tuesday'],
    ['tues', 'tuesday'],
    ['tuesday', 'tuesday'],
    ['wed', 'wednesday'],
    ['wednesday', 'wednesday'],
    ['thu', 'thursday'],
    ['thur', 'thursday'],
    ['thurs', 'thursday'],
    ['thursday', 'thursday'],
    ['fri', 'friday'],
    ['friday', 'friday'],
    ['sat', 'saturday'],
    ['saturday', 'saturday'],
  ].map(([alias, day]) => [alias, day])
);

function padTwo(value) {
  return String(value).padStart(2, '0');
}

function normalizeTimeString(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return `${padTwo(hours)}:${padTwo(minutes)}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTimeString(value);
  if (!normalized) {
    return null;
  }
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const normalized = Number(minutes);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }
  return `${padTwo(Math.floor(normalized / 60) % 24)}:${padTwo(normalized % 60)}`;
}

function parseWeeklySchedule(source) {
  const rawSchedule =
    source?.weeklySchedule ||
    source?.schedule ||
    source?.hours ||
    source?.openHours ||
    source?.pickupHours ||
    null;

  const schedule = { ...DEFAULT_WEEKLY_SCHEDULE };
  if (!rawSchedule || typeof rawSchedule !== 'object') {
    return schedule;
  }

  const entries = Array.isArray(rawSchedule)
    ? rawSchedule.reduce((acc, entry) => {
        if (entry && entry.day) {
          acc[entry.day] = entry.windows || entry;
        }
        return acc;
      }, {})
    : rawSchedule;

  Object.entries(entries).forEach(([dayKey, value]) => {
    const normalizedDay = WEEKDAY_ALIASES.get(String(dayKey).trim().toLowerCase());
    if (!normalizedDay) {
      return;
    }

    const windows = Array.isArray(value)
      ? value
      : Array.isArray(value?.windows)
        ? value.windows
        : value?.open && value?.close
          ? [value]
          : [];

    const normalizedWindows = windows
      .map((window) => {
        const open = normalizeTimeString(window?.open || window?.start || window?.from);
        const close = normalizeTimeString(window?.close || window?.end || window?.to);
        if (!open || !close) {
          return null;
        }
        return { open, close };
      })
      .filter(Boolean)
      .sort((a, b) => timeToMinutes(a.open) - timeToMinutes(b.open));

    if (normalizedWindows.length > 0) {
      schedule[normalizedDay] = normalizedWindows;
    } else if (Array.isArray(value) && value.length === 0) {
      schedule[normalizedDay] = [];
    }
  });

  return schedule;
}

function normalizePickupHours(source = {}) {
  const timezone = source.timezone || source.tz || DEFAULT_TIMEZONE;
  const asapAllowed = source.asapAllowed !== false && source.allowAsap !== false;
  return {
    timezone,
    asapAllowed,
    weeklySchedule: parseWeeklySchedule(source),
  };
}

function getLocalParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
}

function buildLocalDateString(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getWindowsForDay(weeklySchedule, dayKey) {
  return weeklySchedule[String(dayKey || '').toLowerCase()] || [];
}

function isMinuteWithinWindow(minutes, window) {
  const openMinutes = timeToMinutes(window.open);
  const closeMinutes = timeToMinutes(window.close);
  if (openMinutes === null || closeMinutes === null) {
    return false;
  }
  if (closeMinutes > openMinutes) {
    return minutes >= openMinutes && minutes < closeMinutes;
  }
  if (closeMinutes === openMinutes) {
    return false;
  }
  return minutes >= openMinutes || minutes < closeMinutes;
}

function buildPickupAvailability(source = {}, now = new Date()) {
  const pickupHours = normalizePickupHours(source);
  const localNow = getLocalParts(now, pickupHours.timezone);
  const dayKey = String(localNow.weekday || '').toLowerCase();
  const currentMinutes = Number(localNow.hour || 0) * 60 + Number(localNow.minute || 0);
  const todaysWindows = getWindowsForDay(pickupHours.weeklySchedule, dayKey);
  const isOpenNow = todaysWindows.some((window) => isMinuteWithinWindow(currentMinutes, window));
  const today = {
    date: buildLocalDateString(localNow),
    weekday: dayKey,
    openTime: todaysWindows[0]?.open || null,
    closeTime: todaysWindows[todaysWindows.length - 1]?.close || null,
    windows: todaysWindows.map((window) => ({
      open: window.open,
      close: window.close,
    })),
  };

  return {
    timezone: pickupHours.timezone,
    asapAllowed: pickupHours.asapAllowed,
    isOpenNow,
    statusMessage: isOpenNow
      ? null
      : 'Currently the restaurant is closed, but you can still place an order for later pickup.',
    today,
    weeklySchedule: DAY_ORDER.map((day) => ({
      day,
      windows: getWindowsForDay(pickupHours.weeklySchedule, day).map((window) => ({
        open: window.open,
        close: window.close,
      })),
    })),
  };
}

function validateScheduledPickupTime(pickupTime, source = {}) {
  if (!pickupTime) {
    return null;
  }

  const scheduledDate = new Date(pickupTime);
  if (Number.isNaN(scheduledDate.getTime())) {
    const error = new Error('pickupTime must be a valid ISO date-time');
    error.code = 'invalid_pickup_time';
    throw error;
  }

  const pickupHours = normalizePickupHours(source);
  const localParts = getLocalParts(scheduledDate, pickupHours.timezone);
  const dayKey = String(localParts.weekday || '').toLowerCase();
  const minutes = Number(localParts.hour || 0) * 60 + Number(localParts.minute || 0);
  const windows = getWindowsForDay(pickupHours.weeklySchedule, dayKey);

  const isValid = windows.some((window) => isMinuteWithinWindow(minutes, window));
  if (!isValid) {
    const error = new Error('Pickup time is outside restaurant open hours. Please choose another time.');
    error.code = 'pickup_time_out_of_hours';
    throw error;
  }

  return {
    pickupTime: scheduledDate.toISOString(),
    timezone: pickupHours.timezone,
    day: dayKey,
    minutes,
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_WEEKLY_SCHEDULE,
  buildPickupAvailability,
  normalizePickupHours,
  validateScheduledPickupTime,
};
