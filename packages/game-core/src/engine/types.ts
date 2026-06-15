import type { PlayerRef } from "@card-games/shared";

export type GameDefinition<State extends { gameId: string }, Action> = {
  id: State["gameId"];
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  createInitialState(players: PlayerRef[]): State;
  applyAction(state: State, action: Action): State;
  getPublicState(state: State, viewerPlayerId: string): unknown;
  isFinished(state: State): boolean;
};
