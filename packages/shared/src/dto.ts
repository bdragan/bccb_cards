import { z } from "zod";

import { cardSchema } from "./cards";
import { gameIdSchema } from "./games";

export const registerSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(40),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

export type AuthResponse = {
  accessToken: string;
  user: AuthUser;
};

export type AckSuccess<T> = { ok: true; data: T };
export type AckFailure = { ok: false; error: string };
export type Ack<T> = AckSuccess<T> | AckFailure;

export const createRoomPayloadSchema = z.object({
  gameId: gameIdSchema,
});

export const joinRoomPayloadSchema = z.object({
  roomCode: z.string().min(4).max(12),
});

export const roomIdPayloadSchema = z.object({
  roomId: z.string().min(1),
});

export const readyPayloadSchema = z.object({
  roomId: z.string().min(1),
  ready: z.boolean(),
});

export type RoomPublicPlayer = {
  playerId: string;
  displayName: string;
  connected: boolean;
  ready: boolean;
};

export type RoomPublicState = {
  id: string;
  code: string;
  gameId: "greater-card";
  players: RoomPublicPlayer[];
  phase: string;
  createdAt: string;
};

export type GreaterCardPublicPlayer = {
  playerId: string;
  displayName: string;
  ready: boolean;
  hasDrawn: boolean;
  drawnCard?: z.infer<typeof cardSchema>;
};

export type GreaterCardPublicState = {
  gameId: "greater-card";
  phase:
    | "waiting-for-players"
    | "ready-check"
    | "drawing"
    | "revealed"
    | "finished";
  players: GreaterCardPublicPlayer[];
  winnerPlayerIds: string[];
  createdAt: string;
  finishedAt?: string;
};

export type GreaterCardResult = {
  roomId: string;
  gameId: "greater-card";
  winnerPlayerIds: string[];
  tied: boolean;
  players: Array<{
    playerId: string;
    displayName: string;
    card?: z.infer<typeof cardSchema>;
    outcome: "win" | "loss" | "tie";
    score?: number;
  }>;
};
