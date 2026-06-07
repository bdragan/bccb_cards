import { describe, expect, it } from "vitest";

import { compareRanks, createDeck } from "../index";

describe("cards", () => {
  it("creates a 52-card deck", () => {
    expect(createDeck()).toHaveLength(52);
  });

  it("contains unique cards", () => {
    const deck = createDeck();
    expect(new Set(deck.map((card) => card.id)).size).toBe(52);
  });

  it("compares ranks", () => {
    expect(compareRanks("10", "9")).toBeGreaterThan(0);
    expect(compareRanks("2", "3")).toBeLessThan(0);
  });

  it("treats ace as higher than king", () => {
    expect(compareRanks("A", "K")).toBeGreaterThan(0);
  });
});
