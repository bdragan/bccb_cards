import type { GreaterCardState } from "@card-games/game-core";
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
  state: GreaterCardState;
  createdAt: Date;
  persistedMatchId?: string;
};
