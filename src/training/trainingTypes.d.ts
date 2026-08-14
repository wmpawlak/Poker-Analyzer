export type ExerciseType =
  | 'preflop_selection'
  | 'preflop_vs_reraise'
  | 'cbet_barrels'
  | 'turn_river'
  | 'equity_pot_odds';
export type EquityMode = 'known_hand' | 'range' | 'pot_odds' | 'mixed';
export type TrainingRefreshJobKind = 'answer_keys' | 'missing_keys' | 'equity_supplement';

export type TrainingGameType = 'cash' | 'tournament';
export type TrainingSessionGameType = TrainingGameType | 'both';
export type TrainingGrade = 'correct' | 'acceptable' | 'incorrect';

export interface DecisionCardFacts {
  madeHand: string;
  flushStatus: 'made' | 'draw' | 'backdoor_draw' | 'none';
  cardsToCome: number;
  suitCounts: {
    hero: Record<'c' | 'd' | 'h' | 's', number>;
    board: Record<'c' | 'd' | 'h' | 's', number>;
  };
}

export interface TrainingSpot {
  id: string;
  versionId: string;
  handId: string;
  exerciseType: ExerciseType;
  equityMode?: EquityMode | null;
  gameType: TrainingGameType;
  heroHand: { notation: string; class: 'offsuit' | 'suited' | 'pair' } | null;
  decisionCardFacts: DecisionCardFacts;
  street: 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER';
  question: Record<string, unknown>;
  answerOptions: Array<{
    id: string;
    action: string;
    category?: string | null;
    label?: string;
    lowerPercent?: number;
    upperPercent?: number;
    equityPercent?: number;
  }>;
  equityAnswerOptions?: TrainingSpot['answerOptions'];
  actionAnswerOptions?: TrainingSpot['answerOptions'];
  opponentRange?: Array<{ handClass: string; weight: 0.25 | 0.5 | 0.75 | 1 }> | null;
  historicalAnswer: Record<string, unknown>;
  active: boolean;
  readiness: 'pending_key' | 'ready' | 'review';
  aiFirstSentAt: string | null;
  aiFirstSentJobId: string | null;
  sourceStatus: 'current' | 'changed' | 'removed';
  knownOpponentCards?: string[] | null;
  equityCalculatorVersion?: string | null;
  equityCorrectBucket?: string | null;
  equityResult?: Record<string, unknown> | null;
  equitySupplementAvailable?: boolean;
}

export interface EquitySupplement {
  id: string;
  spotVersionId: string;
  answerKeyId: string;
  opponentRange: Array<{ handClass: string; weight: 0.25 | 0.5 | 0.75 | 1 }>;
  rangeContractVersion: number;
  calculatorVersion: string;
  equityResult: Record<string, unknown>;
  model?: { id: string; name: string } | null;
  createdAt: string;
  staleAt?: string | null;
}

export interface AnswerKey {
  id: string;
  spotVersionId: string;
  preferredAnswer: string | null;
  acceptableAlternatives: string[];
  confidence: 'high' | 'medium' | 'low';
  localFactsValid: boolean;
  status: 'ready' | 'review' | 'superseded';
  contractVersion: number;
  decisionCardFacts: DecisionCardFacts | null;
  factsValidationVersion: number;
  rationale: string;
  blockersEquity: string;
  opponentRange: string;
  suggestedSizing: { action: string; potRatio: number; raiseToBb: number };
  model?: { id: string; name: string } | null;
  createdAt: string;
}

export interface TrainingAttempt {
  id: string;
  sessionId: string;
  spotVersionId: string;
  answer: string;
  grade: TrainingGrade;
  answerKeyId: string;
  answeredAt: string;
  equityBucket?: string | null;
  equityGrade?: TrainingGrade;
  actionGrade?: TrainingGrade;
}

export interface TrainingSession {
  id: string;
  exerciseType: ExerciseType;
  gameType: TrainingSessionGameType;
  equityMode?: EquityMode | null;
  requestedSize: 10 | 20 | 50 | 100 | 'all';
  targetSize: number;
  status: 'active' | 'completed' | 'abandoned';
  availableSpotVersionIds: string[];
  answeredSpotVersionIds: string[];
  currentSpotVersionId: string | null;
  score: Record<TrainingGrade, number>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  abandonedAt: string | null;
}

export interface RefreshJob {
  id: string;
  status: 'running' | 'stop_requested' | 'stopped' | 'failed' | 'completed' | 'superseded';
  modelId: string;
  contractVersion: number;
  batchSize: number;
  sampleSize: number;
  candidateCount: number;
  estimatedRequests: number;
  cursor: number;
  attemptedRequests: number;
  successfulRequests: number;
  recoveryCount: number;
  lastRecoveredAt: string | null;
  inFlightSpotCount: number;
  jobKind: TrainingRefreshJobKind;
  createdAt: string;
  updatedAt: string;
}

export const EXERCISE_TYPES: Readonly<{
  PREFLOP_SELECTION: 'preflop_selection';
  PREFLOP_VS_RERAISE: 'preflop_vs_reraise';
  CBET_BARRELS: 'cbet_barrels';
  TURN_RIVER: 'turn_river';
  EQUITY_POT_ODDS: 'equity_pot_odds';
}>;
export const EQUITY_MODES: Readonly<{
  KNOWN_HAND: 'known_hand';
  RANGE: 'range';
  POT_ODDS: 'pot_odds';
  MIXED: 'mixed';
}>;
export const TRAINING_GAME_TYPES: Readonly<{
  CASH: 'cash';
  TOURNAMENT: 'tournament';
  BOTH: 'both';
}>;
export const TRAINING_SESSION_SIZES: readonly [10, 20, 50, 100, 'all'];
export const TRAINING_REFRESH_SAMPLE_SIZES: readonly [100, 200, 300, 400, 500, 600, 700, 800];
export const DEFAULT_TRAINING_REFRESH_SAMPLE_SIZE: 100;
export const TRAINING_GRADES: Readonly<{
  CORRECT: 'correct';
  ACCEPTABLE: 'acceptable';
  INCORRECT: 'incorrect';
}>;

export function isExerciseType(value: unknown): value is ExerciseType;
export function isTrainingGameType(
  value: unknown,
  options?: { allowBoth?: boolean },
): value is TrainingSessionGameType;
export function isTrainingSessionSize(value: unknown): value is TrainingSession['requestedSize'];
export function isTrainingRefreshSampleSize(value: unknown): value is 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800;
