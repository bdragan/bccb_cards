import type { Card } from "@card-games/shared";

export type GreaterCardPhase = "waiting-for-players" | "ready-check" | "drawing" | "revealed" | "finished";

export type GreaterCardPlayerState = {
  playerId: string;
  displayName: string;
  ready: boolean;
  drawnCard?: Card;
};

export type GreaterCardState = {
  gameId: "greater-card";
  phase: GreaterCardPhase;
  deck: Card[];
  players: GreaterCardPlayerState[];
  winnerPlayerIds: string[];
  createdAt: string;
  finishedAt?: string;
};

export type GreaterCardAction =
  | { type: "sync-players"; players: Array<{ playerId: string; displayName: string }> }
  | { type: "set-ready"; playerId: string; ready: boolean }
  | { type: "draw-card"; playerId: string }
  | { type: "restart" };
