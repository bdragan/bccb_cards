import type { Ack, GreaterCardPublicState, GreaterCardResult, RoomPublicState } from "./dto";

export type ClientToServerEvents = {
  "room:create": (payload: { gameId: "greater-card" }, ack: (response: Ack<{ roomId: string; roomCode: string }>) => void) => void;
  "room:join": (payload: { roomCode: string }, ack: (response: Ack<{ roomId: string }>) => void) => void;
  "room:leave": (payload: { roomId: string }, ack: (response: Ack<{ ok: true }>) => void) => void;
  "player:ready": (payload: { roomId: string; ready: boolean }, ack: (response: Ack<{ ok: true }>) => void) => void;
  "game:draw-card": (payload: { roomId: string }, ack: (response: Ack<{ ok: true }>) => void) => void;
  "game:restart": (payload: { roomId: string }, ack: (response: Ack<{ ok: true }>) => void) => void;
};

export type ServerToClientEvents = {
  "room:state": (payload: RoomPublicState) => void;
  "game:state": (payload: GreaterCardPublicState) => void;
  "game:result": (payload: GreaterCardResult) => void;
  "room:error": (payload: { message: string }) => void;
};
