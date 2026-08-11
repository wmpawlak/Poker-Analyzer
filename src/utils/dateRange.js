export const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const isValidDate = (value) => value instanceof Date && Number.isFinite(value.getTime());

// Tworzy datę w lokalnej strefie czasowej, bez konwersji przez UTC.
export const dateStringToLocalDate = (value, { endOfDay = false } = {}) => {
  const match = DATE_INPUT_PATTERN.exec(String(value || '').trim());
  if (!match) return null;

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(0);
  date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  date.setFullYear(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
};

export const localDateToDateString = (value) => {
  if (!isValidDate(value)) return '';
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getLocalDateRange = (from = '', to = '') => {
  const normalizedFrom = String(from || '').trim();
  const normalizedTo = String(to || '').trim();
  const fromDate = normalizedFrom ? dateStringToLocalDate(normalizedFrom) : null;
  const toDate = normalizedTo ? dateStringToLocalDate(normalizedTo, { endOfDay: true }) : null;
  const error = (normalizedFrom && !fromDate) || (normalizedTo && !toDate)
    ? 'Wprowadź poprawną datę w formacie RRRR-MM-DD.'
    : fromDate && toDate && fromDate > toDate
      ? 'Data „od” nie może być późniejsza niż data „do”.'
      : null;

  return {
    valid: !error,
    error,
    fromDate,
    toDate,
    fromTimestamp: fromDate?.getTime() ?? null,
    toTimestamp: toDate?.getTime() ?? null,
    isEmpty: !normalizedFrom && !normalizedTo,
  };
};
