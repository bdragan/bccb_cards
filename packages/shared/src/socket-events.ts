import type {
  Ack,
  BellotDeclaration,
  BellotPublicState,
  BellotResult,
  GreaterCardPublicState,
  GreaterCardResult,
  RoomPublicState,
} from "./dto";
import type { Suit } from "./cards";

export type ClientToServerEvents = {
  "room:create": (
    payload: { gameId: RoomPublicState["gameId"] },
    ack: (response: Ack<{ roomId: string; roomCode: string }>) => void,
  ) => void;
  "room:join": (
    payload: { roomCode: string },
    ack: (response: Ack<{ roomId: string }>) => void,
  ) => void;
  "room:leave": (
    payload: { roomId: string },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "player:ready": (
    payload: { roomId: string; ready: boolean },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "game:draw-card": (
    payload: { roomId: string },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "bellot:trump-decision": (
    payload:
      | { roomId: string; kind: "pass" }
      | { roomId: string; kind: "accept-upcard" }
      | { roomId: string; kind: "choose-suit"; suit: Suit },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "bellot:declare": (
    payload: { roomId: string; declarations: BellotDeclaration[] },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "bellot:play-card": (
    payload: { roomId: string; cardId: string },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "bellot:next-hand": (
    payload: { roomId: string },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "game:restart": (
    payload: { roomId: string },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
};

export type ServerToClientEvents = {
  "room:state": (payload: RoomPublicState) => void;
  "game:state": (payload: GreaterCardPublicState | BellotPublicState) => void;
  "game:result": (payload: GreaterCardResult | BellotResult) => void;
  "room:error": (payload: { message: string }) => void;
};
