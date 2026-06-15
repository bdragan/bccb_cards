import type {
  BellotDeclaration,
  BellotDeclarationType,
  Card,
  PlayerRef,
  Suit,
} from "@card-games/shared";

export type BellotPhase =
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

export type BellotPlayerState = PlayerRef & {
  ready: boolean;
  hand: Card[];
  hiddenCards: Card[];
  pickupCardIds?: string[];
  wonCards: Card[];
  tricksWon: number;
  totalScore: number;
};

export type BellotTrickPlay = {
  playerId: string;
  card: Card;
};

export type BellotCompletedTrick = {
  winnerPlayerId: string;
  cards: BellotTrickPlay[];
};

export type BellotHandResult = {
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

export type BellotState = {
  gameId: "bellot";
  phase: BellotPhase;
  deck: Card[];
  unusedCards: Card[];
  players: BellotPlayerState[];
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
  currentTrick: BellotTrickPlay[];
  completedTricks: BellotCompletedTrick[];
  declarationsByPlayer: Record<string, BellotDeclaration[]>;
  publicCardsByPlayer: Record<string, Card[]>;
  lastHandResult?: BellotHandResult;
  handResults?: BellotHandResult[];
  winnerPlayerId?: string;
  createdAt: string;
  finishedAt?: string;
  error?: string;
};

export type BellotAction =
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
      declarations: BellotDeclaration[];
    }
  | { type: "play-card"; playerId: string; cardId: string }
  | { type: "next-hand" }
  | { type: "restart" };

export type BellotDeclarationCandidate = {
  type: BellotDeclarationType;
  cards: Card[];
  points: number;
};
