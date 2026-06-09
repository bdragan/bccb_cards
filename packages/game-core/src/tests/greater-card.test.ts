import { describe, expect, it } from "vitest";

import type { GreaterCardState } from "../games/greater-card";
import {
  applyGreaterCardAction,
  createGreaterCardInitialState,
  getGreaterCardPublicState,
} from "../index";

const players = [
  { playerId: "p1", displayName: "Player One" },
  { playerId: "p2", displayName: "Player Two" },
];

function drawingState(
  overrides: Partial<GreaterCardState> = {},
): GreaterCardState {
  return {
    ...createGreaterCardInitialState(players),
    phase: "drawing",
    deck: [
      { id: "A-leaves", rank: "A", suit: "leaves" },
      { id: "K-hearts", rank: "K", suit: "hearts" },
      { id: "VII-acorns", rank: "VII", suit: "acorns" },
    ],
    players: players.map((player) => ({ ...player, ready: true })),
    ...overrides,
  };
}

describe("GreaterCard", () => {
  it("starts in the ready-check phase when enough players are present", () => {
    expect(createGreaterCardInitialState(players).phase).toBe("ready-check");
  });

  it("starts in waiting-for-players without enough players", () => {
    expect(createGreaterCardInitialState([players[0]]).phase).toBe(
      "waiting-for-players",
    );
  });

  it("does not let a player draw twice", () => {
    const state = applyGreaterCardAction(drawingState(), {
      type: "draw-card",
      playerId: "p1",
    });
    expect(() =>
      applyGreaterCardAction(state, { type: "draw-card", playerId: "p1" }),
    ).toThrow("already drawn");
  });

  it("reveals only after all players draw", () => {
    const state = applyGreaterCardAction(drawingState(), {
      type: "draw-card",
      playerId: "p1",
    });
    const publicForP2 = getGreaterCardPublicState(state, "p2");

    expect(state.phase).toBe("drawing");
    expect(
      publicForP2.players.find((player) => player.playerId === "p1")?.drawnCard,
    ).toBeUndefined();

    const revealed = applyGreaterCardAction(state, {
      type: "draw-card",
      playerId: "p2",
    });
    expect(revealed.phase).toBe("revealed");
    expect(
      getGreaterCardPublicState(revealed, "p2").players[0].drawnCard?.rank,
    ).toBe("A");
  });

  it("sets a single highest-card winner", () => {
    const first = applyGreaterCardAction(drawingState(), {
      type: "draw-card",
      playerId: "p1",
    });
    const finished = applyGreaterCardAction(first, {
      type: "draw-card",
      playerId: "p2",
    });

    expect(finished.winnerPlayerIds).toEqual(["p1"]);
  });

  it("uses suit as a tiebreaker for matching ranks", () => {
    const first = applyGreaterCardAction(
      drawingState({
        deck: [
          { id: "A-leaves", rank: "A", suit: "leaves" },
          { id: "A-hearts", rank: "A", suit: "hearts" },
        ],
      }),
      { type: "draw-card", playerId: "p1" },
    );
    const finished = applyGreaterCardAction(first, {
      type: "draw-card",
      playerId: "p2",
    });

    expect(finished.winnerPlayerIds).toEqual(["p1"]);
  });
});
