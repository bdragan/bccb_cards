import type {
  Ack,
  BelotDeclaration,
  BelotPublicState,
  BelotResult,
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
  "belot:trump-decision": (
    payload:
      | { roomId: string; kind: "pass" }
      | { roomId: string; kind: "accept-upcard" }
      | { roomId: string; kind: "choose-suit"; suit: Suit },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "belot:declare": (
    payload: { roomId: string; declarations: BelotDeclaration[] },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "belot:play-card": (
    payload: { roomId: string; cardId: string },
    ack: (response: Ack<{ ok: true }>) => void,
  ) => void;
  "belot:next-hand": (
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
  "game:state": (payload: GreaterCardPublicState | BelotPublicState) => void;
  "game:result": (payload: GreaterCardResult | BelotResult) => void;
  "room:error": (payload: { message: string }) => void;
};
