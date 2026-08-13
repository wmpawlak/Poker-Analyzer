export type ExerciseType =
  | 'preflop_selection'
  | 'preflop_vs_reraise'
  | 'cbet_barrels'
  | 'turn_river';

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
  gameType: TrainingGameType;
  heroHand: { notation: string; class: 'offsuit' | 'suited' | 'pair' } | null;
  decisionCardFacts: DecisionCardFacts;
  street: 'PRE_FLOP' | 'FLOP' | 'TURN' | 'RIVER';
  question: Record<string, unknown>;
  answerOptions: Array<{ id: string; action: string; category?: string | null }>;
  historicalAnswer: Record<string, unknown>;
  active: boolean;
  readiness: 'pending_key' | 'ready' | 'review';
  aiFirstSentAt: string | null;
  aiFirstSentJobId: string | null;
  sourceStatus: 'current' | 'changed' | 'removed';
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
}

export interface TrainingSession {
  id: string;
  exerciseType: ExerciseType;
  gameType: TrainingSessionGameType;
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
  createdAt: string;
  updatedAt: string;
}

export const EXERCISE_TYPES: Readonly<{
  PREFLOP_SELECTION: 'preflop_selection';
  PREFLOP_VS_RERAISE: 'preflop_vs_reraise';
  CBET_BARRELS: 'cbet_barrels';
  TURN_RIVER: 'turn_river';
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
