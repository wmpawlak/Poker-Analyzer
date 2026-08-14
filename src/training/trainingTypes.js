/**
 * @typedef {'preflop_selection'|'preflop_vs_reraise'|'cbet_barrels'|'turn_river'|'equity_pot_odds'} ExerciseType
 * @typedef {'known_hand'|'range'|'pot_odds'|'mixed'} EquityMode
 * @typedef {'answer_keys'|'missing_keys'|'equity_supplement'} TrainingRefreshJobKind
 *
 * @typedef {object} DecisionCardFacts
 * @property {string} madeHand
 * @property {'made'|'draw'|'backdoor_draw'|'none'} flushStatus
 * @property {number} cardsToCome
 * @property {{hero: object, board: object}} suitCounts
 *
 * @typedef {object} TrainingSpot
 * @property {string} versionId
 * @property {ExerciseType} exerciseType
 * @property {EquityMode|null} equityMode
 * @property {'cash'|'tournament'} gameType
 * @property {{notation: string, class: 'offsuit'|'suited'|'pair'}|null} heroHand
 * @property {DecisionCardFacts} decisionCardFacts
 * @property {object} question
 * @property {Array<{id: string, action: string, label?: string, lowerPercent?: number, upperPercent?: number, equityPercent?: number}>} answerOptions
 * @property {Array<{id: string, action: string, label?: string, lowerPercent?: number, upperPercent?: number, equityPercent?: number}>} equityAnswerOptions
 * @property {Array<{id: string, action: string, label?: string, category?: string}>} actionAnswerOptions
 * @property {boolean} active
 * @property {'pending_key'|'ready'|'review'} readiness
 * @property {string|null} aiFirstSentAt
 * @property {string|null} aiFirstSentJobId
 * @property {string[]|null} knownOpponentCards
 * @property {string|null} equityCalculatorVersion
 * @property {string|null} equityCorrectBucket
 * @property {object|null} equityResult
 * @property {Array<{handClass: string, weight: number}>} opponentRange
 * @property {boolean} equitySupplementAvailable

 * @typedef {object} EquitySupplement
 * @property {string} id
 * @property {string} spotVersionId
 * @property {string} answerKeyId
 * @property {Array<{handClass: string, weight: number}>} opponentRange
 * @property {number} rangeContractVersion
 * @property {string} calculatorVersion
 * @property {object} equityResult
 * @property {object|null} model
 * @property {string} createdAt
 * @property {string|null} staleAt
 *
 * @typedef {object} AnswerKey
 * @property {string} id
 * @property {string} spotVersionId
 * @property {string|null} preferredAnswer
 * @property {string[]} acceptableAlternatives
 * @property {'high'|'medium'|'low'} confidence
 * @property {boolean} localFactsValid
 * @property {'ready'|'review'|'superseded'} status
 * @property {number} contractVersion
 * @property {DecisionCardFacts|null} decisionCardFacts
 * @property {number} factsValidationVersion
 *
 * @typedef {object} TrainingAttempt
 * @property {string} id
 * @property {string} sessionId
 * @property {string} spotVersionId
 * @property {string} answer
 * @property {'correct'|'acceptable'|'incorrect'} grade
 * @property {string} answerKeyId
 * @property {string} answeredAt
 * @property {string|null} equityBucket
 * @property {'correct'|'acceptable'|'incorrect'} equityGrade
 * @property {'correct'|'acceptable'|'incorrect'} actionGrade
 *
 * @typedef {object} TrainingSession
 * @property {string} id
 * @property {ExerciseType} exerciseType
 * @property {'cash'|'tournament'|'both'} gameType
 * @property {10|20|50|100|'all'} requestedSize
 * @property {number} targetSize
 * @property {'active'|'completed'|'abandoned'} status
 * @property {string[]} availableSpotVersionIds
 * @property {string[]} answeredSpotVersionIds
 * @property {string|null} currentSpotVersionId
 * @property {string|null} abandonedAt
 *
 * @typedef {object} RefreshJob
 * @property {string} id
 * @property {'running'|'stop_requested'|'stopped'|'failed'|'completed'|'superseded'} status
 * @property {string} modelId
 * @property {number} contractVersion
 * @property {number} batchSize
 * @property {number} sampleSize
 * @property {number} candidateCount
 * @property {number} cursor
 * @property {number} recoveryCount
 * @property {string|null} lastRecoveredAt
 * @property {number} inFlightSpotCount
 * @property {TrainingRefreshJobKind} jobKind
 */

export const EXERCISE_TYPES = Object.freeze({
  PREFLOP_SELECTION: 'preflop_selection',
  PREFLOP_VS_RERAISE: 'preflop_vs_reraise',
  CBET_BARRELS: 'cbet_barrels',
  TURN_RIVER: 'turn_river',
  EQUITY_POT_ODDS: 'equity_pot_odds',
});

export const EQUITY_MODES = Object.freeze({
  KNOWN_HAND: 'known_hand',
  RANGE: 'range',
  POT_ODDS: 'pot_odds',
  MIXED: 'mixed',
});

export const TRAINING_GAME_TYPES = Object.freeze({
  CASH: 'cash',
  TOURNAMENT: 'tournament',
  BOTH: 'both',
});

export const TRAINING_SESSION_SIZES = Object.freeze([10, 20, 50, 100, 'all']);

export const TRAINING_REFRESH_SAMPLE_SIZES = Object.freeze([100, 200, 300, 400, 500, 600, 700, 800]);
export const DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE = 100;

export const TRAINING_GRADES = Object.freeze({
  CORRECT: 'correct',
  ACCEPTABLE: 'acceptable',
  INCORRECT: 'incorrect',
});

export const isExerciseType = (value) => Object.values(EXERCISE_TYPES).includes(value);
export const isTrainingGameType = (value, { allowBoth = true } = {}) => (
  Object.values(TRAINING_GAME_TYPES).includes(value) && (allowBoth || value !== TRAINING_GAME_TYPES.BOTH)
);
export const isTrainingSessionSize = (value) => TRAINING_SESSION_SIZES.includes(value);
export const isTrainingRefreshSampleSize = (value) => TRAINING_REFRESH_SAMPLE_SIZES.includes(value);
