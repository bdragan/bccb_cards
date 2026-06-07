import { z } from "zod";

export const gameIds = ["greater-card"] as const;

export type GameId = (typeof gameIds)[number];

export type GameMetadata = {
  id: GameId;
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
};

export type PlayerRef = {
  playerId: string;
  displayName: string;
};

export const gameIdSchema = z.enum(gameIds);

export const gameMetadataSchema = z.object({
  id: gameIdSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive()
});
