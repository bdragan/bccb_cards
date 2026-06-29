import type {
  BelotDeclaration,
  BelotDeclarationType,
  Card,
  PlayerRef,
  Suit,
} from "@card-games/shared";

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

export type BelotPlayerState = PlayerRef & {
  ready: boolean;
  hand: Card[];
  hiddenCards: Card[];
  pickupCardIds?: string[];
  wonCards: Card[];
  tricksWon: number;
  totalScore: number;
};

export type BelotTrickPlay = {
  playerId: string;
  card: Card;
};

export type BelotCompletedTrick = {
  winnerPlayerId: string;
  cards: BelotTrickPlay[];
};

export type BelotHandResult = {
  dealerPlayerId?: string;
  callerPlayerId: string;
  opponentPlayerId: string;
  trumpSuit?: Suit;
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

export type BelotRules = {
  declarationsEnabled: boolean;
};

export type BelotInitialStateOptions = Partial<BelotRules>;

export type BelotState = {
  gameId: "belot";
  rules?: BelotRules;
  phase: BelotPhase;
  deck: Card[];
  unusedCards: Card[];
  players: BelotPlayerState[];
  dealerPlayerId?: string;
  firstPlayerId?: string;
  trumpSuit?: Suit;
  callerPlayerId?: string;
  isMus: boolean;
  upcard?: Card;
  trumpRound: 0 | 1 | 2 | 3;
  trumpTurnPlayerId?: string;
  trumpPasses: string[];
  currentTurnPlayerId?: string;
  currentTrick: BelotTrickPlay[];
  completedTricks: BelotCompletedTrick[];
  declarationsByPlayer: Record<string, BelotDeclaration[]>;
  publicCardsByPlayer: Record<string, Card[]>;
  lastHandResult?: BelotHandResult;
  handResults?: BelotHandResult[];
  winnerPlayerId?: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
};

export type BelotAction =
  | {
      type: "sync-players";
      players: Array<{ playerId: string; displayName: string }>;
    }
  | { type: "set-ready"; playerId: string; ready: boolean }
  | { type: "trump-pass"; playerId: string }
  | { type: "trump-accept-upcard"; playerId: string }
  | { type: "trump-choose-suit"; playerId: string; suit: Suit }
  | {
      type: "declare";
      playerId: string;
      declarations: BelotDeclaration[];
    }
  | { type: "play-card"; playerId: string; cardId: string }
  | { type: "next-hand" }
  | { type: "restart" };

export type BelotDeclarationCandidate = {
  type: BelotDeclarationType;
  cards: Card[];
  points: number;
};
