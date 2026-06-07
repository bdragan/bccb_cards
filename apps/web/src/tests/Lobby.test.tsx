import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Lobby } from "../components/Lobby";

describe("Lobby", () => {
  it("renders players", () => {
    render(
      <Lobby
        room={{
          id: "room1",
          code: "ABCD12",
          gameId: "greater-card",
          phase: "ready-check",
          createdAt: new Date().toISOString(),
          players: [
            { playerId: "p1", displayName: "Alice", connected: true, ready: false },
            { playerId: "p2", displayName: "Bob", connected: true, ready: true }
          ]
        }}
        currentPlayerId="p1"
        onReady={vi.fn()}
      />
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });
});
