import { z } from "zod";

export const suits = ["clubs", "diamonds", "hearts", "spades"] as const;
export const ranks = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
] as const;

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
