import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GreaterCardTable } from "../components/GreaterCardTable";

const baseState = {
  gameId: "greater-card" as const,
  phase: "drawing" as const,
  winnerPlayerIds: [],
  createdAt: new Date().toISOString(),
  players: [
    { playerId: "p1", displayName: "Alice", ready: true, hasDrawn: true },
    { playerId: "p2", displayName: "Bob", ready: true, hasDrawn: false }
  ]
};

describe("GreaterCardTable", () => {
  it("disables draw button when not allowed", () => {
    render(
      <GreaterCardTable state={baseState} currentPlayerId="p1" onDraw={vi.fn()} onRestart={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: "Draw card" })).toBeDisabled();
  });

  it("displays winner result", () => {
    render(
      <GreaterCardTable
        state={{ ...baseState, phase: "revealed", winnerPlayerIds: ["p1"] }}
        currentPlayerId="p1"
        onDraw={vi.fn()}
        onRestart={vi.fn()}
        result={{
          roomId: "room1",
          gameId: "greater-card",
          tied: false,
          winnerPlayerIds: ["p1"],
          players: [
            {
              playerId: "p1",
              displayName: "Alice",
              outcome: "win",
              card: { id: "A-spades", rank: "A", suit: "spades" },
              score: 14
            },
            {
              playerId: "p2",
              displayName: "Bob",
              outcome: "loss",
              card: { id: "K-clubs", rank: "K", suit: "clubs" },
              score: 13
            }
          ]
        }}
      />
    );

    expect(screen.getByText("Winner")).toBeInTheDocument();
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
  });

  it("displays tie result", () => {
    render(
      <GreaterCardTable
        state={{ ...baseState, phase: "revealed", winnerPlayerIds: ["p1", "p2"] }}
        currentPlayerId="p1"
        onDraw={vi.fn()}
        onRestart={vi.fn()}
        result={{
          roomId: "room1",
          gameId: "greater-card",
          tied: true,
          winnerPlayerIds: ["p1", "p2"],
          players: [
            { playerId: "p1", displayName: "Alice", outcome: "tie", score: 14 },
            { playerId: "p2", displayName: "Bob", outcome: "tie", score: 14 }
          ]
        }}
      />
    );

    expect(screen.getByText("Tie game")).toBeInTheDocument();
  });
});
