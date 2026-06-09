import { z } from "zod";

export const suits = ["acorns", "bells", "hearts", "leaves"] as const;
export const ranks = ["VII", "VIII", "IX", "X", "U", "O", "K", "A"] as const;

export type Suit = (typeof suits)[number];
export type Rank = (typeof ranks)[number];

export type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
};

export const suitSchema = z.enum(suits);
export const rankSchema = z.enum(ranks);

export const cardSchema = z.object({
  id: z.string().min(1),
  suit: suitSchema,
  rank: rankSchema,
});
