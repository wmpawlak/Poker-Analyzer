import { dateStringToLocalDate, localDateToDateString } from './dateRange.js';

const EMPTY_RANGE = Object.freeze({ from: '', to: '' });

const cloneAndShiftDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const getDateRangePresets = (today = new Date()) => {
  const currentDay = dateStringToLocalDate(localDateToDateString(today)) || new Date();
  const end = localDateToDateString(currentDay);
  const recentRange = (days) => ({
    from: localDateToDateString(cloneAndShiftDays(currentDay, -(days - 1))),
    to: end,
  });

  return [
    { id: 'all', label: 'Cała historia', range: EMPTY_RANGE },
    { id: '7-days', label: '7 dni', range: recentRange(7) },
    { id: '30-days', label: '30 dni', range: recentRange(30) },
    { id: '90-days', label: '90 dni', range: recentRange(90) },
    { id: 'current-month', label: 'Bieżący miesiąc', range: { from: `${end.slice(0, 8)}01`, to: end } },
    { id: 'current-year', label: 'Bieżący rok', range: { from: `${end.slice(0, 4)}-01-01`, to: end } },
  ];
};
