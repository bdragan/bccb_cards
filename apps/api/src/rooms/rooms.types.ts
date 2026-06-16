import type { BelotState } from "@card-games/game-core";
import type { GameId } from "@card-games/shared";

export type RoomPlayer = {
  playerId: string;
  displayName: string;
  socketIds: Set<string>;
};

export type Room = {
  id: string;
  code: string;
  gameId: GameId;
  players: RoomPlayer[];
  state: BelotState;
  createdAt: Date;
  persistedMatchId?: string;
};
