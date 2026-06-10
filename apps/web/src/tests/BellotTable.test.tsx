import type { BellotPublicState, Card } from "@card-games/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BellotTable } from "../components/BellotTable";

function card(rank: Card["rank"], suit: Card["suit"]): Card {
  return { id: `${rank}-${suit}`, rank, suit };
}

const baseState: BellotPublicState = {
  gameId: "bellot",
  phase: "trick-play",
  players: [
    {
      playerId: "p1",
      displayName: "Alice",
      ready: true,
      hand: [
        card("A", "hearts"),
        card("X", "acorns"),
        card("VII", "acorns"),
        card("IX", "bells"),
      ],
      handCount: 4,
      publicCards: [],
      declarationsSubmitted: true,
      totalScore: 0,
      handScore: 0,
      tricksWon: 0,
    },
    {
      playerId: "p2",
      displayName: "Bob",
      ready: true,
      handCount: 4,
      publicCards: [],
      declarationsSubmitted: true,
      totalScore: 0,
      handScore: 0,
      tricksWon: 1,
    },
  ],
  dealerPlayerId: "p2",
  firstPlayerId: "p1",
  trumpSuit: "hearts",
  callerPlayerId: "p1",
  isMus: false,
  upcard: card("K", "leaves"),
  currentTurnPlayerId: "p1",
  currentTrick: [],
  completedTricks: [
    {
      winnerPlayerId: "p2",
      cards: [
        { playerId: "p1", card: card("VII", "acorns") },
        { playerId: "p2", card: card("A", "acorns") },
      ],
    },
  ],
  declarationsByPlayer: {
    p1: [
      {
        type: "FOUR_NINES",
        points: 150,
        cards: [
          card("IX", "hearts"),
          card("IX", "acorns"),
          card("IX", "leaves"),
          card("IX", "bells"),
        ],
      },
    ],
  },
  publicCardsByPlayer: {
    p1: [
      card("IX", "hearts"),
      card("IX", "acorns"),
      card("IX", "leaves"),
      card("IX", "bells"),
    ],
    p2: [],
  },
  createdAt: new Date().toISOString(),
};

function renderTable(state: BellotPublicState = baseState) {
  return render(
    <BellotTable
      state={state}
      currentPlayerId="p1"
      onTrumpDecision={vi.fn()}
      onDeclare={vi.fn()}
      onPlayCard={vi.fn()}
      onNextHand={vi.fn()}
      onRestart={vi.fn()}
    />,
  );
}

describe("BellotTable", () => {
  it("sorts the player's hand by suit and rank and keeps the upcard visible", () => {
    renderTable();

    const handCards = screen
      .getAllByTestId("bellot-hand-card")
      .map((button) => within(button).getByRole("img").getAttribute("alt"));

    expect(handCards).toEqual([
      "VII of Acorns",
      "X of Acorns",
      "IX of Bells",
      "A of Hearts",
    ]);
    expect(screen.getByAltText("K of Leaves")).toBeInTheDocument();
  });

  it("groups declaration cards and dims called cards after they are played", () => {
    const playedDeclaration = {
      ...baseState,
      completedTricks: [
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p1", card: card("IX", "bells") },
            { playerId: "p2", card: card("A", "bells") },
          ],
        },
      ],
    } satisfies BellotPublicState;

    renderTable(playedDeclaration);

    const group = screen.getByText("Four Nines").parentElement!;
    const declarationCards = within(group).getAllByRole("img");

    expect(declarationCards.map((img) => img.getAttribute("alt"))).toEqual([
      "IX of Acorns",
      "IX of Bells",
      "IX of Hearts",
      "IX of Leaves",
    ]);
    expect(within(group).getByAltText("IX of Bells").parentElement).toHaveClass(
      "opacity-45",
    );
  });

  it("shows played hands and highlights the trick winner's card", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "Show played hands" }));

    const hand = screen.getByText("Hand 1 · Bob").parentElement!;

    expect(
      within(hand).getByAltText("A of Acorns").parentElement,
    ).not.toHaveClass("opacity-45");
    expect(
      within(hand).getByAltText("VII of Acorns").parentElement,
    ).toHaveClass("opacity-45");
  });
});
