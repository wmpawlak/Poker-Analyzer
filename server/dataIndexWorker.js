import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import {
  buildTourneySessions,
  parseSingleRawHand,
} from '../src/parser/pokerParser.js';
import { buildSessionAnalysisInput } from '../src/ai/sessionAnalysisContract.js';
import { buildProfileReport } from '../src/utils/profileReport.js';
import { buildStartingHandStats } from '../src/utils/startingHandStats.js';

const CASH_SESSION_BREAK_MS = 30 * 60 * 1000;
const JSONL_FILE_PATTERN = /^(cash|tournament)-\d{4}\.jsonl$/;

const sendProgress = (phase, current = 0, total = 0) => {
  parentPort?.postMessage({ type: 'progress', phase, current, total });
};

const readCanonicalFiles = async (dataDirectory) => {
  const handsDirectory = path.join(dataDirectory, 'poker', 'hands');
  let entries;
  try {
    entries = await fs.readdir(handsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && JSONL_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const stripRawText = (hand, location) => {
  const withoutRawText = { ...hand };
  delete withoutRawText.rawText;
  return { ...withoutRawText, location };
};

const readHands = async (dataDirectory) => {
  const files = await readCanonicalFiles(dataDirectory);
  const hands = [];
  sendProgress('parsing', 0, files.length);

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const fileName = files[fileIndex];
    const filePath = path.join(dataDirectory, 'poker', 'hands', fileName);
    const text = await fs.readFile(filePath, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, lineIndex) => {
      if (!line.trim()) return;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new Error(`Nieprawidłowy JSONL: ${fileName}, linia ${lineIndex + 1}.`);
      }
      const parsed = parseSingleRawHand(record.rawText);
      if (!parsed.hand) {
        throw new Error(`Nie można sparsować kanonicznego rozdania #${record.handId || '?'}.`);
      }
      if (String(parsed.hand.id) !== String(record.handId)) {
        throw new Error(`Niezgodne handId w ${fileName}, linia ${lineIndex + 1}.`);
      }
      hands.push(stripRawText(parsed.hand, {
        file: `poker/hands/${fileName}`,
        line: lineIndex + 1,
      }));
    });
    sendProgress('parsing', fileIndex + 1, files.length);
  }
  return hands.sort((left, right) => left.timestamp - right.timestamp || String(left.id).localeCompare(String(right.id)));
};

const finalizeCashSession = (tableId, hands) => {
  const firstHand = hands[0];
  const sessionIdSeed = `${tableId}\u0000${firstHand.id}`;
  const id = `cash_${createHash('sha256').update(sessionIdSeed).digest('hex').slice(0, 16)}`;
  let runningProfit = 0;
  const sessionHands = hands.map((hand, index) => ({ ...hand, sessionHandIndex: index + 1 }));
  const chartData = sessionHands.map((hand) => {
    runningProfit += Number(hand.netProfit) || 0;
    return { handIndex: hand.sessionHandIndex, profit: Number(runningProfit.toFixed(2)) };
  });
  return {
    id,
    tableId,
    startTime: firstHand.timestamp,
    lastTimestamp: sessionHands.at(-1).timestamp,
    dateStr: firstHand.dateStr,
    hands: sessionHands,
    totalProfit: Number(runningProfit.toFixed(2)),
    type: 'Cash',
    chartData,
  };
};

const buildCashSessions = (hands) => {
  const handsByTable = new Map();
  hands.filter((hand) => !hand.isTournament).forEach((hand) => {
    const tableId = String(hand.tableId || 'Nieznany');
    const tableHands = handsByTable.get(tableId) || [];
    tableHands.push(hand);
    handsByTable.set(tableId, tableHands);
  });

  const sessions = [];
  handsByTable.forEach((tableHands, tableId) => {
    const ordered = [...tableHands].sort((left, right) => left.timestamp - right.timestamp);
    let current = [];
    ordered.forEach((hand) => {
      const previous = current.at(-1);
      if (previous && hand.timestamp - previous.timestamp > CASH_SESSION_BREAK_MS) {
        sessions.push(finalizeCashSession(tableId, current));
        current = [];
      }
      current.push(hand);
    });
    if (current.length > 0) sessions.push(finalizeCashSession(tableId, current));
  });
  return sessions.sort((left, right) => right.startTime - left.startTime);
};

const buildOpponents = (hands, sessionIdByHand) => {
  const opponents = new Map();
  hands.forEach((hand) => {
    const values = Array.isArray(hand.opponents) ? hand.opponents : [];
    values.forEach((rawOpponent) => {
      const id = String(rawOpponent || '').trim();
      if (!id) return;
      const current = opponents.get(id) || {
        id,
        handsPlayed: 0,
        sessions: new Set(),
        showdowns: 0,
        heroWins: 0,
        heroLosses: 0,
        netExchanged: 0,
      };
      current.handsPlayed += 1;
      current.sessions.add(sessionIdByHand.get(String(hand.id)) || 'unknown');
      if (hand.sawShowdown) current.showdowns += 1;
      const profitShare = (Number(hand.netProfit) || 0) / values.length;
      if (hand.outcome === 'WON') {
        current.heroWins += 1;
        current.netExchanged += profitShare;
      } else if (hand.outcome === 'LOST') {
        current.heroLosses += 1;
        current.netExchanged += profitShare;
      }
      opponents.set(id, current);
    });
  });
  return [...opponents.values()]
    .map(({ sessions, ...opponent }) => ({
      ...opponent,
      sessionsCount: sessions.size,
      netExchanged: Number(opponent.netExchanged.toFixed(2)),
    }))
    .sort((left, right) => right.handsPlayed - left.handsPlayed || left.id.localeCompare(right.id));
};

const buildWalletAggregate = (cashHands) => {
  let profit = 0;
  const positions = new Map();
  const timeline = cashHands.map((hand, index) => {
    profit += Number(hand.netProfit) || 0;
    const position = hand.position || 'UNKNOWN';
    if (position !== 'UNKNOWN') {
      const current = positions.get(position) || { position, wins: 0, total: 0 };
      current.total += 1;
      if (hand.outcome === 'WON') current.wins += 1;
      positions.set(position, current);
    }
    return {
      handIndex: index + 1,
      timestamp: hand.timestamp,
      date: hand.dateStr,
      profit: Number(profit.toFixed(2)),
    };
  });
  return {
    timeline,
    positionFrequencyData: [...positions.values()],
    maxPosHands: Math.max(...[...positions.values()].map(({ total }) => total), 1),
    totalHands: cashHands.length,
    totalProfit: Number(profit.toFixed(2)),
  };
};

const toProfileAggregate = (hands) => {
  const cashHands = hands.filter((hand) => !hand.isTournament);
  const tournamentHands = hands.filter((hand) => hand.isTournament);
  const report = buildProfileReport({ cashHands, tournamentHands });
  return {
    isValid: report.isValid,
    error: report.error,
    dateRange: report.dateRange,
    gameType: report.gameType,
    metrics: report.metrics,
    cashMetrics: report.cashMetrics,
    tournamentMetrics: report.tournamentMetrics,
    handCount: report.hands.length,
    cashHandCount: report.cashHands.length,
    tournamentHandCount: report.tournamentHands.length,
  };
};

const buildIndex = async () => {
  sendProgress('scanning', 0, 0);
  const hands = await readHands(workerData.dataDirectory);
  sendProgress('aggregating', 0, 4);
  const cashSessions = buildCashSessions(hands);
  sendProgress('aggregating', 1, 4);
  const tournamentSessions = buildTourneySessions(hands.filter((hand) => hand.isTournament));
  sendProgress('aggregating', 2, 4);
  const sessionIdByHand = new Map();
  [...cashSessions, ...tournamentSessions].forEach((session) => {
    session.hands.filter((hand) => !hand.isRebuy).forEach((hand) => {
      hand.sessionId = session.id;
      sessionIdByHand.set(String(hand.id), session.id);
    });
    session.fingerprint = buildSessionAnalysisInput({
      sessionId: session.id,
      hands: session.hands,
      gameType: session.type === 'Cash' ? 'cash' : 'tournament',
    }).fingerprint;
  });
  const indexedHands = hands.map((hand) => ({
    ...hand,
    sessionId: sessionIdByHand.get(String(hand.id)) || null,
  }));
  const cashHands = indexedHands.filter((hand) => !hand.isTournament);
  sendProgress('aggregating', 3, 4);
  const aggregates = {
    profile: toProfileAggregate(indexedHands),
    opponents: buildOpponents(indexedHands, sessionIdByHand),
    cards: {
      all: buildStartingHandStats(indexedHands),
      riverOrShowdown: buildStartingHandStats(indexedHands, { riverOrShowdownOnly: true }),
    },
    wallet: buildWalletAggregate(cashHands),
  };
  sendProgress('aggregating', 4, 4);
  return {
    formatVersion: workerData.formatVersion,
    parserVersion: workerData.parserVersion,
    datasetRevision: workerData.datasetRevision,
    builtAt: new Date().toISOString(),
    hands: indexedHands,
    sessions: { cash: cashSessions, tournament: tournamentSessions },
    aggregates,
  };
};

try {
  const index = await buildIndex();
  parentPort?.postMessage({ type: 'complete', index });
} catch (error) {
  parentPort?.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : String(error),
  });
}
