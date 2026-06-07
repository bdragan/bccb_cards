import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@card-games/shared";
import { io, type Socket } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createGameSocket(token: string): GameSocket {
  return io(`${API_URL}/game`, {
    auth: { token },
    transports: ["websocket"],
  });
}
