export const createLargeSessionMonthFixture = ({ monthCount = 12, sessionsPerMonth = 100 } = {}) => {
  const months = [];
  const sessionsByMonth = {};
  for (let offset = 0; offset < monthCount; offset += 1) {
    const date = new Date(Date.UTC(2026, 11 - offset, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const sessions = Array.from({ length: sessionsPerMonth }, (_, index) => {
      const day = (index % 28) + 1;
      const dateStr = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
      return {
        id: `cash-${key}-${String(index + 1).padStart(3, '0')}`,
        type: 'Cash',
        tableId: `${key}-${index + 1}`,
        startTime: Date.UTC(year, month - 1, day, 12, index % 60),
        lastTimestamp: Date.UTC(year, month - 1, day, 13, index % 60),
        dateStr,
        totalProfit: index - 50,
        fingerprint: `fingerprint-${key}-${index + 1}`,
        handCount: 10,
        matchingHandCount: 10,
        rebuys: 0,
        mergedFromSessionIds: [],
      };
    });
    months.push({
      key,
      year,
      month,
      sessionCount: sessions.length,
      handCount: sessions.length * 10,
      matchingHandCount: sessions.length * 10,
      cashSessionCount: sessions.length,
      tournamentSessionCount: 0,
    });
    sessionsByMonth[key] = sessions;
  }
  return {
    datasetRevision: 'large-month-fixture',
    months,
    sessionsByMonth,
    sessions: months.flatMap(({ key }) => sessionsByMonth[key]),
  };
};
