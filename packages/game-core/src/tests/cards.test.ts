import { describe, expect, it } from "vitest";

import { compareCards, compareRanks, compareSuits, createDeck } from "../index";

describe("cards", () => {
  it("creates a 32-card Hungarian deck", () => {
    expect(createDeck()).toHaveLength(32);
  });

  it("contains unique cards", () => {
    const deck = createDeck();
    expect(new Set(deck.map((card) => card.id)).size).toBe(32);
  });

  it("compares ranks", () => {
    expect(compareRanks("X", "IX")).toBeGreaterThan(0);
    expect(compareRanks("VII", "VIII")).toBeLessThan(0);
  });

  it("treats ace as higher than king", () => {
    expect(compareRanks("A", "K")).toBeGreaterThan(0);
  });

  it("maps Hungarian suits to regular poker suit order", () => {
    expect(compareSuits("bells", "acorns")).toBeGreaterThan(0);
    expect(compareSuits("leaves", "hearts")).toBeGreaterThan(0);
  });

  it("compares cards by rank before suit", () => {
    expect(
      compareCards(
        { id: "VII-leaves", rank: "VII", suit: "leaves" },
        { id: "A-acorns", rank: "A", suit: "acorns" },
      ),
    ).toBeLessThan(0);
    expect(
      compareCards(
        { id: "A-leaves", rank: "A", suit: "leaves" },
        { id: "A-hearts", rank: "A", suit: "hearts" },
      ),
    ).toBeGreaterThan(0);
  });
});
