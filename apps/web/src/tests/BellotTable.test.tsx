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
      gamePoints: 0,
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
      gamePoints: 11,
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

  it("separates the player's hand into suit groups horizontally", () => {
    renderTable();

    const suitGroups = screen.getAllByTestId("bellot-hand-suit-group");

    expect(
      suitGroups.map((group) =>
        within(group)
          .getAllByTestId("bellot-hand-card")
          .map((button) => within(button).getByRole("img").getAttribute("alt")),
      ),
    ).toEqual([
      ["VII of Acorns", "X of Acorns"],
      ["IX of Bells"],
      ["A of Hearts"],
    ]);
  });

  it("marks hidden pickup cards after they enter the player's hand", () => {
    renderTable({
      ...baseState,
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? { ...player, pickupCardIds: ["IX-bells", "A-hearts"] }
          : player,
      ),
    });

    const markedCards = screen
      .getAllByText("Hidden pickup card")
      .map((label) =>
        within(label.closest("button")!).getByRole("img").getAttribute("alt"),
      );

    expect(markedCards).toEqual(["IX of Bells", "A of Hearts"]);
    expect(
      screen.getAllByText("Hidden pickup card")[0].closest("button"),
    ).toHaveClass("ring-4");
  });

  it("shows hand results in the middle with revealed player cards and Tesla", () => {
    renderTable({
      ...baseState,
      phase: "hand-complete",
      currentTurnPlayerId: undefined,
      currentTrick: [],
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [],
              handCount: 0,
              pickupCardIds: ["A-hearts"],
            }
          : {
              ...player,
              handCount: 0,
              pickupCardIds: ["K-hearts"],
            },
      ),
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("VII", "acorns") },
            { playerId: "p2", card: card("A", "acorns") },
          ],
        },
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p1", card: card("A", "hearts") },
            { playerId: "p2", card: card("K", "hearts") },
          ],
        },
      ],
      unusedCards: [card("IX", "leaves"), card("X", "bells")],
      lastHandResult: {
        callerPlayerId: "p1",
        opponentPlayerId: "p2",
        gamePointsByPlayer: { p1: 21, p2: 15 },
        declarationPointsByPlayer: { p1: 0, p2: 0 },
        totalPointsByPlayer: { p1: 21, p2: 15 },
        handScoreByPlayer: { p1: 2, p2: 1 },
        schusterPlayerIds: [],
        callerFell: false,
        callerFellOnGame: false,
        isMus: false,
        lastTrickWinnerPlayerId: "p2",
      },
    });

    const result = screen.getByTestId("bellot-hand-result");
    const playedTricksButton = screen.getByRole("button", {
      name: "Show played tricks",
    });

    expect(
      screen.queryByTestId("bellot-current-trick"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("bellot-hand-card")).not.toBeInTheDocument();
    expect(
      result.compareDocumentPosition(playedTricksButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(result).toHaveClass("bg-white/10", "text-white");

    expect(
      within(screen.getByText("Alice:").parentElement!)
        .getAllByRole("img")
        .map((img) => img.getAttribute("alt")),
    ).toEqual(["VII of Acorns", "A of Hearts"]);
    expect(
      within(screen.getByText("Bob:").parentElement!)
        .getAllByRole("img")
        .map((img) => img.getAttribute("alt")),
    ).toEqual(["A of Acorns", "K of Hearts"]);
    expect(
      within(screen.getByText("Tesla:").parentElement!)
        .getAllByRole("img")
        .map((img) => img.getAttribute("alt")),
    ).toEqual(["X of Bells", "IX of Leaves"]);
    expect(screen.getAllByText("Hidden pickup card")).toHaveLength(2);
    expect(
      screen.getAllByText("Hidden pickup card")[0].parentElement,
    ).toHaveClass("ring-4");
  });

  it("shows declaration bonus points and dims called cards after they are played", () => {
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

    const group = screen.getByText("150 bonus pts").parentElement!;
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

  it("keeps the current trick area mounted when trick play has no cards", () => {
    renderTable({
      ...baseState,
      currentTrick: [],
      completedTricks: [],
    });

    const currentTrick = screen.getByTestId("bellot-current-trick");

    expect(within(currentTrick).getByText("Current trick")).toBeInTheDocument();
    expect(
      currentTrick.querySelector(".min-h-\\[114px\\]"),
    ).toBeInTheDocument();
  });

  it("shows trump selection logs in the current trick area", () => {
    renderTable({
      ...baseState,
      phase: "trump-round-one",
      trumpSuit: undefined,
      callerPlayerId: undefined,
      trumpTurnPlayerId: "p2",
      trumpPasses: ["p1"],
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
    });

    const currentTrick = screen.getByTestId("bellot-current-trick");

    expect(
      within(currentTrick).getByText("Trump selection"),
    ).toBeInTheDocument();
    expect(
      within(currentTrick).getByText("Upcard is K of Leaves."),
    ).toBeInTheDocument();
    expect(
      within(currentTrick).getByText("Alice passed on Leaves."),
    ).toBeInTheDocument();
    expect(
      within(currentTrick).getByText(
        "Bob is deciding whether to accept the upcard suit.",
      ),
    ).toBeInTheDocument();
  });

  it("shows mus logs in the current trick area", () => {
    renderTable({
      ...baseState,
      phase: "mus",
      trumpSuit: undefined,
      callerPlayerId: undefined,
      trumpTurnPlayerId: "p1",
      trumpPasses: [],
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
    });

    const currentTrick = screen.getByTestId("bellot-current-trick");

    expect(
      within(currentTrick).getByText("Both players passed twice."),
    ).toBeInTheDocument();
    expect(
      within(currentTrick).getByText("Alice is on mus and must choose trump."),
    ).toBeInTheDocument();
  });

  it("renders hand and current trick cards at the source image size", () => {
    renderTable({
      ...baseState,
      currentTrick: [{ playerId: "p2", card: card("K", "hearts") }],
      completedTricks: [],
    });

    const currentTrick = screen.getByTestId("bellot-current-trick");

    expect(within(currentTrick).getByAltText("K of Hearts")).toHaveClass(
      "h-[114px]",
      "w-[71px]",
    );
    expect(
      within(screen.getAllByTestId("bellot-hand-card")[0]).getByRole("img"),
    ).toHaveClass("h-[114px]", "w-[71px]");
  });

  it("shows played tricks and highlights the trick winner's card", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(
      screen.getByRole("button", { name: "Show played tricks" }),
    );

    const hand = screen.getByText("Trick 1 · Bob").parentElement!;

    expect(
      within(hand).getByAltText("A of Acorns").parentElement,
    ).not.toHaveClass("opacity-45");
    expect(
      within(hand).getByAltText("VII of Acorns").parentElement,
    ).toHaveClass("opacity-45");
  });

  it("shows played tricks before the first trick has completed", async () => {
    const user = userEvent.setup();
    renderTable({
      ...baseState,
      currentTrick: [],
      completedTricks: [],
    });

    await user.click(
      screen.getByRole("button", { name: "Show played tricks" }),
    );

    expect(
      screen.getByRole("button", { name: "Hide played tricks" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Trick 1/)).not.toBeInTheDocument();
  });

  it("shows captured game points during trick play", () => {
    renderTable({
      ...baseState,
      players: baseState.players.map((player) =>
        player.playerId === "p1" ? { ...player, gamePoints: 24 } : player,
      ),
    });

    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("shows each player's running game score", () => {
    renderTable({
      ...baseState,
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? { ...player, totalScore: 184 }
          : { ...player, totalScore: 92 },
      ),
    });

    expect(screen.getByText("184")).toBeInTheDocument();
    expect(screen.getByText("92")).toBeInTheDocument();
  });

  it("shows a progress indicator next to the player whose turn it is to play", () => {
    renderTable();

    const turnIndicator = screen.getByRole("progressbar", {
      name: "Alice to play",
    });

    expect(turnIndicator.closest("h3")).toHaveTextContent("Alice");
    expect(
      screen.queryByRole("progressbar", { name: "Bob to play" }),
    ).not.toBeInTheDocument();
  });

  it("shows a progress indicator next to the player choosing trump", () => {
    renderTable({
      ...baseState,
      phase: "trump-round-one",
      trumpSuit: undefined,
      trumpTurnPlayerId: "p2",
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
    });

    const turnIndicator = screen.getByRole("progressbar", {
      name: "Bob to play",
    });

    expect(turnIndicator.closest("h3")).toHaveTextContent("Bob");
    expect(
      screen.queryByRole("progressbar", { name: "Alice to play" }),
    ).not.toBeInTheDocument();
  });

  it("falls back to completed tricks when game points are missing", () => {
    const legacyState = {
      ...baseState,
      players: baseState.players.map(
        ({ gamePoints: _gamePoints, ...player }) =>
          player.playerId === "p2" ? player : { ...player, gamePoints: 0 },
      ),
    } as BellotPublicState;

    renderTable(legacyState);

    expect(screen.getAllByText("11")).not.toHaveLength(0);
  });

  it("separates declaration combinations horizontally", () => {
    renderTable({
      ...baseState,
      declarationsByPlayer: {
        p1: [
          {
            type: "SEQUENCE_3",
            points: 20,
            cards: [
              card("VII", "leaves"),
              card("VIII", "leaves"),
              card("IX", "leaves"),
            ],
          },
          {
            type: "BELOTE",
            points: 20,
            cards: [card("O", "hearts"), card("K", "hearts")],
          },
        ],
      },
    });

    expect(screen.getAllByTestId("bellot-declaration-group")).toHaveLength(2);
  });

  it("hides duplicate belote cards when an ordinary declaration already shows them", () => {
    renderTable({
      ...baseState,
      declarationsByPlayer: {
        p1: [
          {
            type: "SEQUENCE_4",
            points: 50,
            cards: [
              card("X", "hearts"),
              card("U", "hearts"),
              card("O", "hearts"),
              card("K", "hearts"),
            ],
          },
          {
            type: "BELOTE",
            points: 20,
            cards: [card("O", "hearts"), card("K", "hearts")],
          },
        ],
      },
    });

    const group = screen.getByText("70 bonus pts").parentElement!;
    const declarationGroups = within(group).getAllByTestId(
      "bellot-declaration-group",
    );

    expect(declarationGroups).toHaveLength(1);
    expect(
      within(declarationGroups[0])
        .getAllByRole("img")
        .map((img) => img.getAttribute("alt")),
    ).toEqual(["X of Hearts", "U of Hearts", "O of Hearts", "K of Hearts"]);
  });

  it("does not show the upcard suit on mus and uses the correct suit icon", () => {
    renderTable({
      ...baseState,
      phase: "mus",
      trumpSuit: undefined,
      trumpTurnPlayerId: "p1",
      upcard: card("O", "acorns"),
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
    });

    expect(
      screen.queryByRole("button", { name: "Choose Acorns" }),
    ).not.toBeInTheDocument();

    const leavesButton = screen.getByRole("button", { name: "Choose Leaves" });

    expect(within(leavesButton).getByAltText("Leaves")).toHaveAttribute(
      "src",
      "/suits/c.png",
    );
  });
});
