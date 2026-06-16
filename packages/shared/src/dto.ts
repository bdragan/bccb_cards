import { z } from "zod";

import { cardSchema, suitSchema } from "./cards";
import { gameIdSchema } from "./games";

export const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(40),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

export type AuthResponse = {
  accessToken: string;
  user: AuthUser;
};

export type AckSuccess<T> = { ok: true; data: T };
export type AckFailure = { ok: false; error: string };
export type Ack<T> = AckSuccess<T> | AckFailure;

export const createRoomPayloadSchema = z.object({
  gameId: gameIdSchema,
});

export const joinRoomPayloadSchema = z.object({
  roomCode: z.string().min(4).max(12),
});

export const roomIdPayloadSchema = z.object({
  roomId: z.string().min(1),
});

export const readyPayloadSchema = z.object({
  roomId: z.string().min(1),
  ready: z.boolean(),
});

export const belotDeclarationTypeSchema = z.enum([
  "BELOTE",
  "SEQUENCE_3",
  "SEQUENCE_4",
  "SEQUENCE_5_PLUS",
  "FOUR_JACKS",
  "FOUR_NINES",
  "FOUR_ACES",
  "FOUR_TENS",
  "FOUR_KINGS",
  "FOUR_QUEENS",
]);

export const belotDeclarationSchema = z.object({
  type: belotDeclarationTypeSchema,
  cards: z.array(cardSchema).min(2).max(8),
  points: z.number().int(),
});

export const belotTrumpDecisionPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    roomId: z.string().min(1),
    kind: z.literal("pass"),
  }),
  z.object({
    roomId: z.string().min(1),
    kind: z.literal("accept-upcard"),
  }),
  z.object({
    roomId: z.string().min(1),
    kind: z.literal("choose-suit"),
    suit: suitSchema,
  }),
]);

export const belotDeclarePayloadSchema = z.object({
  roomId: z.string().min(1),
  declarations: z.array(belotDeclarationSchema),
});

export const belotPlayCardPayloadSchema = z.object({
  roomId: z.string().min(1),
  cardId: z.string().min(1),
});

export type RoomPublicPlayer = {
  playerId: string;
  displayName: string;
  connected: boolean;
  ready: boolean;
};

export type RoomPublicState = {
  id: string;
  code: string;
  gameId: GamePublicState["gameId"];
  players: RoomPublicPlayer[];
  phase: string;
  createdAt: string;
};

export type GreaterCardPublicPlayer = {
  playerId: string;
  displayName: string;
  ready: boolean;
  hasDrawn: boolean;
  drawnCard?: z.infer<typeof cardSchema>;
};

export type GreaterCardPublicState = {
  gameId: "greater-card";
  phase:
    | "waiting-for-players"
    | "ready-check"
    | "drawing"
    | "revealed"
    | "finished";
  players: GreaterCardPublicPlayer[];
  winnerPlayerIds: string[];
  createdAt: string;
  finishedAt?: string;
};

export type GreaterCardResult = {
  roomId: string;
  gameId: "greater-card";
  winnerPlayerIds: string[];
  tied: boolean;
  players: Array<{
    playerId: string;
    displayName: string;
    card?: z.infer<typeof cardSchema>;
    outcome: "win" | "loss" | "tie";
    score?: number;
  }>;
};

export type BelotDeclarationType = z.infer<typeof belotDeclarationTypeSchema>;

export type BelotDeclaration = z.infer<typeof belotDeclarationSchema>;

export type BelotPhase =
  | "waiting-for-players"
  | "ready-check"
  | "trump-round-one"
  | "trump-round-two"
  | "mus"
  | "declarations"
  | "trick-play"
  | "hand-complete"
  | "finished"
  | "error";

export type BelotPublicPlayer = {
  playerId: string;
  displayName: string;
  ready: boolean;
  hand?: z.infer<typeof cardSchema>[];
  pickupCardIds?: string[];
  handCount: number;
  publicCards: z.infer<typeof cardSchema>[];
  declarationsSubmitted: boolean;
  totalScore: number;
  handScore: number;
  gamePoints: number;
  tricksWon: number;
};

export type BelotTrickPlay = {
  playerId: string;
  card: z.infer<typeof cardSchema>;
};

export type BelotHandResult = {
  dealerPlayerId?: string;
  callerPlayerId: string;
  opponentPlayerId: string;
  trumpSuit?: z.infer<typeof suitSchema>;
  gamePointsByPlayer: Record<string, number>;
  declarationPointsByPlayer: Record<string, number>;
  totalPointsByPlayer: Record<string, number>;
  handScoreByPlayer: Record<string, number>;
  schusterPlayerIds: string[];
  callerFell: boolean;
  callerFellOnGame: boolean;
  isMus: boolean;
  lastTrickWinnerPlayerId: string;
};

export type BelotPublicState = {
  gameId: "belot";
  phase: BelotPhase;
  players: BelotPublicPlayer[];
  dealerPlayerId?: string;
  firstPlayerId?: string;
  trumpSuit?: z.infer<typeof suitSchema>;
  callerPlayerId?: string;
  isMus: boolean;
  upcard?: z.infer<typeof cardSchema>;
  trumpTurnPlayerId?: string;
  trumpPasses?: string[];
  currentTurnPlayerId?: string;
  currentTrick: BelotTrickPlay[];
  completedTricks: Array<{
    winnerPlayerId: string;
    cards: BelotTrickPlay[];
  }>;
  declarationsByPlayer: Record<string, BelotDeclaration[]>;
  publicCardsByPlayer: Record<string, z.infer<typeof cardSchema>[]>;
  unusedCards?: z.infer<typeof cardSchema>[];
  lastHandResult?: BelotHandResult;
  handResults?: BelotHandResult[];
  winnerPlayerId?: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
};

export type BelotResult = {
  roomId: string;
  gameId: "belot";
  winnerPlayerIds: string[];
  tied: boolean;
  players: Array<{
    playerId: string;
    displayName: string;
    outcome: "win" | "loss" | "tie";
    score: number;
  }>;
};

export type GamePublicState = GreaterCardPublicState | BelotPublicState;
export type GameResult = GreaterCardResult | BelotResult;
