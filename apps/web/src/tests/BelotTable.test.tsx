import type { BelotPublicState, Card } from "@card-games/shared";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BelotTable } from "../components/BelotTable";
import { setLocaleForTests } from "../i18n";

function card(rank: Card["rank"], suit: Card["suit"]): Card {
  return { id: `${rank}-${suit}`, rank, suit };
}

const baseState: BelotPublicState = {
  gameId: "belot",
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

function renderTable(
  state: BelotPublicState = baseState,
  currentPlayerId = "p1",
  options: { skipInitialCompletedTrickAnimation?: boolean } = {},
) {
  return render(
    <BelotTable
      state={state}
      currentPlayerId={currentPlayerId}
      onTrumpDecision={vi.fn()}
      onDeclare={vi.fn()}
      onPlayCard={vi.fn()}
      onNextHand={vi.fn()}
      onRestart={vi.fn()}
      skipInitialCompletedTrickAnimation={
        options.skipInitialCompletedTrickAnimation
      }
    />,
  );
}

describe("BelotTable", () => {
  it("does not replay a loaded completed trick animation when requested", () => {
    vi.useFakeTimers();

    try {
      renderTable(baseState, "p1", {
        skipInitialCompletedTrickAnimation: true,
      });

      const currentTrick = screen.getByTestId("belot-current-trick");

      expect(
        within(currentTrick).queryByTestId("belot-current-trick-card"),
      ).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2_000);
      });

      expect(
        within(currentTrick).queryByTestId("belot-current-trick-card"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("belot-played-tricks")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the current player's live section on the left while timeline stays dealer-first", () => {
    renderTable(
      {
        ...baseState,
        dealerPlayerId: "p1",
      },
      "p2",
    );

    const currentPlayerHeading = screen.getByRole("heading", { name: "Bob" });
    const opponentHeading = screen.getByRole("heading", { name: "Alice" });

    expect(
      currentPlayerHeading.compareDocumentPosition(opponentHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    const timeline = screen.getByTestId("belot-game-timeline");

    expect(
      within(timeline)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Hand", "Alice", "Bob"]);
  });

  it("sorts the player's hand by suit and rank and keeps the upcard visible", () => {
    renderTable();

    const handCards = screen
      .getAllByTestId("belot-hand-card")
      .map((button) => within(button).getByRole("img").getAttribute("alt"));

    expect(handCards).toEqual([
      "VII of Acorns",
      "X of Acorns",
      "IX of Bells",
      "A of Hearts",
    ]);
    expect(screen.getByAltText("K of Leaves")).toBeInTheDocument();
  });

  it("links to the Belot rules from the player's hand heading", () => {
    renderTable();

    const rulesLink = screen.getByRole("link", { name: "Rules" });

    expect(rulesLink).toHaveAttribute("href", "/rules/belot-user-en.html");
    expect(rulesLink).toHaveTextContent("?");
  });

  it("links to the French Belot rules when French is selected", () => {
    setLocaleForTests("fr");
    renderTable();

    const rulesLink = screen.getByRole("link", { name: "Règles" });

    expect(rulesLink).toHaveAttribute("href", "/rules/belot-user-fr.html");
    expect(screen.getAllByAltText("A de Coeurs")).not.toHaveLength(0);
  });

  it("separates the player's hand into suit groups horizontally", () => {
    renderTable();

    const suitGroups = screen.getAllByTestId("belot-hand-suit-group");

    expect(
      suitGroups.map((group) =>
        within(group)
          .getAllByTestId("belot-hand-card")
          .map((button) => within(button).getByRole("img").getAttribute("alt")),
      ),
    ).toEqual([
      ["VII of Acorns", "X of Acorns"],
      ["IX of Bells"],
      ["A of Hearts"],
    ]);
  });

  it("can render a non-interactive debug hand above the play area", () => {
    render(
      <BelotTable
        state={baseState}
        currentPlayerId="p1"
        onTrumpDecision={vi.fn()}
        onDeclare={vi.fn()}
        onPlayCard={vi.fn()}
        onNextHand={vi.fn()}
        onRestart={vi.fn()}
        debugHand={{
          label: "AI hand",
          cards: [
            card("A", "bells"),
            card("VII", "acorns"),
            card("IX", "hearts"),
          ],
        }}
      />,
    );

    const debugHand = screen.getByTestId("belot-debug-cpu-hand");

    expect(within(debugHand).getByText("AI hand")).toBeInTheDocument();
    expect(
      within(debugHand)
        .getAllByTestId("belot-debug-cpu-hand-card")
        .map((item) => within(item).getByRole("img").getAttribute("alt")),
    ).toEqual(["VII of Acorns", "A of Bells", "IX of Hearts"]);
    expect(
      within(debugHand).queryAllByRole("button", { hidden: true }),
    ).toHaveLength(0);
  });

  it("sorts hand suit groups by Belot point value after trump is selected", () => {
    renderTable({
      ...baseState,
      trumpSuit: "acorns",
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("U", "acorns"),
                card("IX", "acorns"),
                card("A", "acorns"),
                card("K", "hearts"),
                card("X", "hearts"),
                card("VII", "acorns"),
                card("O", "hearts"),
                card("U", "hearts"),
              ],
              handCount: 8,
            }
          : player,
      ),
      completedTricks: [],
    });

    const suitGroups = screen.getAllByTestId("belot-hand-suit-group");

    expect(
      suitGroups.map((group) =>
        within(group)
          .getAllByTestId("belot-hand-card")
          .map((button) => within(button).getByRole("img").getAttribute("alt")),
      ),
    ).toEqual([
      ["VII of Acorns", "A of Acorns", "IX of Acorns", "U of Acorns"],
      ["U of Hearts", "O of Hearts", "K of Hearts", "X of Hearts"],
    ]);
  });

  it("lightly shadows only illegal hand cards when it is the player's turn", () => {
    renderTable({
      ...baseState,
      currentTrick: [{ playerId: "p2", card: card("A", "acorns") }],
      completedTricks: [],
    });

    const handButtons = screen.getAllByTestId("belot-hand-card");
    const handButton = (label: string) =>
      handButtons.find((button) => within(button).queryByAltText(label))!;

    expect(handButton("VII of Acorns").closest(".opacity-70")).toBeNull();
    expect(handButton("X of Acorns").closest(".opacity-70")).toBeNull();
    expect(handButton("IX of Bells").closest(".opacity-70")).not.toBeNull();
    expect(handButton("A of Hearts").closest(".opacity-70")).not.toBeNull();
  });

  it("lightly shadows all hand cards after trump selection when waiting", () => {
    renderTable({
      ...baseState,
      currentTurnPlayerId: "p2",
      currentTrick: [],
      completedTricks: [],
    });

    for (const button of screen.getAllByTestId("belot-hand-card")) {
      expect(button).toHaveClass("opacity-70");
    }
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
    const markedButton = screen
      .getAllByText("Hidden pickup card")[0]
      .closest("button")!;
    expect(markedButton).not.toHaveClass("ring-4");
    expect(within(markedButton).getByRole("img").parentElement).toHaveClass(
      "ring-2",
      "md:ring-4",
      "ring-cyan-200",
      "ring-offset-1",
      "md:ring-offset-2",
      "ring-offset-ink",
    );
  });

  it("does not show face-down pickup placeholders during trump selection", () => {
    renderTable({
      ...baseState,
      phase: "trump-round-one",
      trumpSuit: undefined,
      callerPlayerId: undefined,
      trumpTurnPlayerId: "p2",
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
      declarationsByPlayer: {},
      publicCardsByPlayer: { p1: [], p2: [] },
      upcard: card("K", "leaves"),
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("VII", "acorns"),
                card("VIII", "acorns"),
                card("IX", "acorns"),
                card("K", "leaves"),
              ],
              handCount: 4,
            }
          : player,
      ),
    });

    expect(
      screen.queryByTestId("belot-hidden-pickup-placeholder"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("belot-hidden-pickup-marker-spacer"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /hidden pickup card/i }),
    ).not.toBeInTheDocument();
  });

  it("marks visible trump cards", () => {
    renderTable({
      ...baseState,
      currentTrick: [{ playerId: "p2", card: card("K", "hearts") }],
      completedTricks: [],
    });

    const trumpCards = screen
      .getAllByTestId("belot-trump-card")
      .map((container) =>
        within(container).getByRole("img").getAttribute("alt"),
      );

    expect(trumpCards).toEqual(["IX of Hearts", "K of Hearts", "A of Hearts"]);
    for (const container of screen.getAllByTestId("belot-trump-card")) {
      expect(within(container).getByText("T")).toBeInTheDocument();
    }
  });

  it("uses A as the French trump marker", () => {
    setLocaleForTests("fr");
    renderTable({
      ...baseState,
      currentTrick: [{ playerId: "p2", card: card("K", "hearts") }],
      completedTricks: [],
    });

    for (const container of screen.getAllByTestId("belot-trump-card")) {
      expect(within(container).getByText("A")).toBeInTheDocument();
    }
  });

  it("marks cards that can participate in pre-pickup bonus points during trump selection", () => {
    renderTable({
      ...baseState,
      phase: "trump-round-one",
      trumpSuit: undefined,
      callerPlayerId: undefined,
      trumpTurnPlayerId: "p2",
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
      declarationsByPlayer: {},
      publicCardsByPlayer: { p1: [], p2: [] },
      upcard: card("K", "leaves"),
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("VII", "acorns"),
                card("VIII", "acorns"),
                card("IX", "acorns"),
                card("K", "leaves"),
              ],
              handCount: 4,
            }
          : player,
      ),
    });

    const bonusCards = screen
      .getAllByTestId("belot-bonus-card")
      .map((container) =>
        within(container).getByRole("img").getAttribute("alt"),
      );

    expect(bonusCards).toEqual([
      "VII of Acorns",
      "VIII of Acorns",
      "IX of Acorns",
    ]);
    for (const container of screen.getAllByTestId("belot-bonus-card")) {
      expect(within(container).getByText("B")).toBeInTheDocument();
    }
    expect(screen.getByTestId("belot-hand-bonus-total")).toHaveTextContent(
      "20 bonus pts",
    );
  });

  it("marks second-round belote bonuses for every possible trump suit but shows only the max total", () => {
    renderTable({
      ...baseState,
      phase: "trump-round-two",
      trumpSuit: undefined,
      callerPlayerId: undefined,
      trumpTurnPlayerId: "p1",
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
      declarationsByPlayer: {},
      publicCardsByPlayer: { p1: [], p2: [] },
      upcard: card("K", "leaves"),
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("O", "acorns"),
                card("K", "acorns"),
                card("O", "bells"),
                card("K", "bells"),
              ],
              handCount: 4,
            }
          : player,
      ),
    });

    const bonusCards = screen
      .getAllByTestId("belot-bonus-card")
      .map((container) =>
        within(container).getByRole("img").getAttribute("alt"),
      );

    expect(bonusCards).toEqual([
      "O of Acorns",
      "K of Acorns",
      "O of Bells",
      "K of Bells",
    ]);
    expect(screen.getByTestId("belot-hand-bonus-total")).toHaveTextContent(
      "20 bonus pts",
    );
  });

  it("removes the pre-pickup bonus indicators after trump selection", () => {
    renderTable({
      ...baseState,
      phase: "declarations",
      trumpSuit: "leaves",
      callerPlayerId: "p2",
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
      declarationsByPlayer: {},
      publicCardsByPlayer: { p1: [], p2: [] },
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("VII", "acorns"),
                card("VIII", "acorns"),
                card("IX", "acorns"),
                card("K", "leaves"),
                card("O", "leaves"),
              ],
              pickupCardIds: ["O-leaves"],
              handCount: 5,
              declarationsSubmitted: false,
            }
          : player,
      ),
    });

    expect(screen.queryByTestId("belot-bonus-card")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("belot-hand-bonus-total"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("belot-hidden-pickup-placeholder"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Hidden pickup card")).toBeInTheDocument();
  });

  it("waits for the final trick linger before showing hand results", () => {
    vi.useFakeTimers();

    try {
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
          callerFell: true,
          callerFellOnGame: false,
          isMus: false,
          lastTrickWinnerPlayerId: "p2",
        },
      });

      const finalTrick = screen.getByTestId("belot-current-trick");

      expect(screen.queryByTestId("belot-hand-result")).not.toBeInTheDocument();
      expect(
        within(finalTrick).queryByText("Completed trick 2"),
      ).not.toBeInTheDocument();
      expect(
        within(finalTrick).getByAltText("A of Hearts"),
      ).toBeInTheDocument();
      expect(
        within(finalTrick).getByAltText("K of Hearts"),
      ).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(screen.queryByTestId("belot-hand-result")).not.toBeInTheDocument();
      expect(screen.getByTestId("belot-current-trick")).toBeInTheDocument();
      screen
        .getAllByTestId("belot-current-trick-card")
        .forEach((cardElement) => {
          expect(cardElement).toHaveAttribute("data-collecting", "true");
        });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      const result = screen.getByTestId("belot-hand-result");
      const startingCards = screen.getByTestId("belot-starting-cards");
      const playedTricks = screen.getByTestId("belot-played-tricks");

      expect(
        screen.queryByTestId("belot-current-trick"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("belot-hand-card")).not.toBeInTheDocument();
      expect(
        result.compareDocumentPosition(startingCards) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(startingCards).toHaveClass("bg-white/10", "text-white");
      expect(
        startingCards.compareDocumentPosition(playedTricks) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);

      expect(within(result).getByText("Hand result")).toBeInTheDocument();
      expect(within(result).queryByText("Alice")).not.toBeInTheDocument();
      expect(within(result).queryByText("Bob")).not.toBeInTheDocument();
      expect(screen.queryByTestId("belot-status")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Belot" }),
      ).not.toBeInTheDocument();

      const scores = within(result).getAllByTestId("belot-result-score");
      const nextHandButton = within(result).getByRole("button", {
        name: "Next hand",
      });
      expect(scores).toHaveLength(2);
      expect(nextHandButton).toHaveClass("belot-next-hand-button");
      expect(scores[0]).toHaveTextContent("2");
      expect(scores[0]).toHaveClass(
        "text-xl",
        "font-bold",
        "text-left",
        "text-white",
      );
      expect(scores[1]).toHaveTextContent("1");
      expect(scores[1]).toHaveClass(
        "text-xl",
        "font-bold",
        "text-right",
        "text-white",
      );
      expect(
        scores[1].compareDocumentPosition(nextHandButton) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(
        screen.getByTestId("belot-trump-upcard-separator"),
      ).toBeInTheDocument();
      expect(screen.queryByText("(fell)")).not.toBeInTheDocument();
      expect(screen.queryByText("Caller fell.")).not.toBeInTheDocument();
      expect(
        within(startingCards).getByText("Starting cards"),
      ).toBeInTheDocument();

      const cardRows = screen.getAllByTestId("belot-result-card-row");
      expect(
        within(cardRows[0])
          .getAllByRole("img")
          .map((img) => img.getAttribute("alt")),
      ).toEqual(["VII of Acorns", "A of Hearts"]);
      expect(
        within(cardRows[1])
          .getAllByRole("img")
          .map((img) => img.getAttribute("alt")),
      ).toEqual(["A of Acorns", "K of Hearts"]);
      expect(
        within(cardRows[2])
          .getAllByRole("img")
          .map((img) => img.getAttribute("alt")),
      ).toEqual(["X of Bells", "IX of Leaves"]);
      expect(screen.getAllByText("Hidden pickup card")).toHaveLength(2);
      expect(
        screen.getAllByText("Hidden pickup card")[0].parentElement,
      ).not.toHaveClass("ring-4");
      expect(
        within(cardRows[0]).getAllByRole("img")[1].parentElement,
      ).toHaveClass(
        "ring-2",
        "md:ring-4",
        "ring-cyan-200",
        "ring-offset-1",
        "md:ring-offset-2",
        "ring-offset-ink",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the finished game winner above starting cards while keeping the hand result", () => {
    vi.useFakeTimers();

    try {
      const onNextHand = vi.fn();
      const onRestart = vi.fn();

      render(
        <BelotTable
          state={{
            ...baseState,
            phase: "finished",
            winnerPlayerId: "p2",
            currentTurnPlayerId: undefined,
            currentTrick: [],
            players: baseState.players.map((player) =>
              player.playerId === "p1"
                ? { ...player, hand: [], handCount: 0 }
                : { ...player, handCount: 0 },
            ),
            lastHandResult: {
              callerPlayerId: "p1",
              opponentPlayerId: "p2",
              gamePointsByPlayer: { p1: 21, p2: 15 },
              declarationPointsByPlayer: { p1: 0, p2: 0 },
              totalPointsByPlayer: { p1: 21, p2: 15 },
              handScoreByPlayer: { p1: 2, p2: 1 },
              schusterPlayerIds: [],
              callerFell: true,
              callerFellOnGame: true,
              isMus: false,
              lastTrickWinnerPlayerId: "p2",
            },
          }}
          currentPlayerId="p1"
          onTrumpDecision={vi.fn()}
          onDeclare={vi.fn()}
          onPlayCard={vi.fn()}
          onNextHand={onNextHand}
          onRestart={onRestart}
        />,
      );

      expect(screen.queryByTestId("belot-winner")).not.toBeInTheDocument();
      expect(screen.queryByTestId("belot-hand-result")).not.toBeInTheDocument();
      expect(screen.getByTestId("belot-current-trick")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2_000);
      });

      const winner = screen.getByTestId("belot-winner");
      const winnerText = within(winner).getByText("Winner: Bob");
      const handResult = screen.getByTestId("belot-hand-result");
      const startingCards = screen.getByTestId("belot-starting-cards");
      const scores = within(handResult).getAllByTestId("belot-result-score");

      expect(
        screen.queryByRole("button", { name: "Next hand" }),
      ).not.toBeInTheDocument();
      expect(within(handResult).getByText("Hand result")).toBeInTheDocument();
      expect(scores[0]).toHaveTextContent("2");
      expect(scores[1]).toHaveTextContent("1");
      expect(
        winner.compareDocumentPosition(startingCards) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(winner).toHaveClass(
        "mt-4",
        "rounded-md",
        "bg-red-300",
        "p-3",
        "text-center",
        "text-ink",
      );
      expect(winner).not.toHaveClass("bg-white/10", "bg-sky-300", "text-white");
      expect(winnerText).toHaveClass("text-lg", "font-bold");

      fireEvent.click(within(winner).getByRole("button", { name: "New game" }));

      expect(onNextHand).not.toHaveBeenCalled();
      expect(onRestart).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a light blue finished game panel when the current player wins", () => {
    vi.useFakeTimers();

    try {
      renderTable({
        ...baseState,
        phase: "finished",
        winnerPlayerId: "p1",
        currentTurnPlayerId: undefined,
        currentTrick: [],
        players: baseState.players.map((player) =>
          player.playerId === "p1"
            ? { ...player, hand: [], handCount: 0 }
            : { ...player, handCount: 0 },
        ),
        lastHandResult: {
          callerPlayerId: "p1",
          opponentPlayerId: "p2",
          gamePointsByPlayer: { p1: 32, p2: 4 },
          declarationPointsByPlayer: { p1: 0, p2: 0 },
          totalPointsByPlayer: { p1: 32, p2: 4 },
          handScoreByPlayer: { p1: 3, p2: 0 },
          schusterPlayerIds: [],
          callerFell: false,
          callerFellOnGame: false,
          isMus: false,
          lastTrickWinnerPlayerId: "p1",
        },
      });

      act(() => {
        vi.advanceTimersByTime(2_000);
      });

      expect(screen.getByTestId("belot-winner")).toHaveClass(
        "bg-sky-300",
        "text-ink",
      );
      expect(screen.getByTestId("belot-winner")).not.toHaveClass("bg-red-300");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows CPU level progress above the new game button", () => {
    render(
      <BelotTable
        state={{
          ...baseState,
          phase: "finished",
          winnerPlayerId: "p1",
          currentTurnPlayerId: undefined,
          currentTrick: [],
        }}
        currentPlayerId="p1"
        onTrumpDecision={vi.fn()}
        onDeclare={vi.fn()}
        onPlayCard={vi.fn()}
        onNextHand={vi.fn()}
        onRestart={vi.fn()}
        levelProgress={{
          level: "Silver",
          points: 2,
          highestLevel: "Silver",
          highestPoints: 2,
        }}
      />,
    );

    const winner = screen.getByTestId("belot-winner");
    const progress = within(winner).getByTestId("cpu-level-progress");
    const newGameButton = within(winner).getByRole("button", {
      name: "New game",
    });

    expect(progress).toHaveTextContent("Your current rank is: Silver");
    expect(progress).not.toHaveTextContent("Silver 3");
    expect(
      within(progress).getByTestId("cpu-level-progress-icon"),
    ).toHaveAttribute("data-level", "Silver");
    expect(progress).toHaveAttribute("aria-valuemax", "4");
    expect(progress).toHaveAttribute("aria-valuenow", "2");
    expect(progress).toHaveAttribute("role", "progressbar");
    expect(
      progress.compareDocumentPosition(newGameButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    expect(
      Array.from(progress.querySelectorAll("[data-filled]")).map((point) =>
        point.getAttribute("data-filled"),
      ),
    ).toEqual(["true", "true", "false", "false"]);
  });

  it("translates level names while showing non-Grandmaster rank points", () => {
    setLocaleForTests("fr");

    render(
      <BelotTable
        state={{
          ...baseState,
          phase: "finished",
          winnerPlayerId: "p1",
          currentTurnPlayerId: undefined,
          currentTrick: [],
        }}
        currentPlayerId="p1"
        onTrumpDecision={vi.fn()}
        onDeclare={vi.fn()}
        onPlayCard={vi.fn()}
        onNextHand={vi.fn()}
        onRestart={vi.fn()}
        levelProgress={{
          level: "Silver",
          points: 2,
          highestLevel: "Silver",
          highestPoints: 2,
        }}
      />,
    );

    const progress = screen.getByTestId("cpu-level-progress");

    expect(progress).toHaveTextContent("Votre rang actuel est : Argent");
    expect(progress).toHaveAttribute("aria-valuemax", "4");
    expect(progress).toHaveAttribute("aria-valuenow", "2");
    expect(progress.querySelectorAll("[data-filled]")).toHaveLength(4);
  });

  it("shows Grandmaster progress as a number without dots", () => {
    render(
      <BelotTable
        state={{
          ...baseState,
          phase: "finished",
          winnerPlayerId: "p1",
          currentTurnPlayerId: undefined,
          currentTrick: [],
        }}
        currentPlayerId="p1"
        onTrumpDecision={vi.fn()}
        onDeclare={vi.fn()}
        onPlayCard={vi.fn()}
        onNextHand={vi.fn()}
        onRestart={vi.fn()}
        levelProgress={{
          level: "Grandmaster",
          points: 17,
          highestLevel: "Grandmaster",
          highestPoints: 17,
        }}
      />,
    );

    const progress = screen.getByTestId("cpu-level-progress");

    expect(progress).toHaveTextContent("Your current rank is: Grandmaster 17");
    expect(
      within(progress).getByTestId("cpu-level-progress-icon"),
    ).toHaveAttribute("data-level", "Grandmaster");
    expect(progress.querySelector("[data-filled]")).toBeNull();
    expect(progress).not.toHaveAttribute("aria-valuemax");
  });

  it("sorts end-of-hand player rows by Belot point value within suit groups", () => {
    vi.useFakeTimers();

    try {
      renderTable({
        ...baseState,
        phase: "hand-complete",
        trumpSuit: "acorns",
        currentTurnPlayerId: undefined,
        currentTrick: [],
        players: baseState.players.map((player) =>
          player.playerId === "p1"
            ? { ...player, hand: [], handCount: 0 }
            : { ...player, handCount: 0 },
        ),
        completedTricks: [
          {
            winnerPlayerId: "p1",
            cards: [
              { playerId: "p1", card: card("U", "acorns") },
              { playerId: "p1", card: card("IX", "acorns") },
              { playerId: "p1", card: card("A", "acorns") },
              { playerId: "p1", card: card("VII", "acorns") },
              { playerId: "p1", card: card("K", "hearts") },
              { playerId: "p1", card: card("X", "hearts") },
              { playerId: "p1", card: card("O", "hearts") },
              { playerId: "p1", card: card("U", "hearts") },
              { playerId: "p2", card: card("A", "hearts") },
            ],
          },
        ],
        lastHandResult: {
          callerPlayerId: "p1",
          opponentPlayerId: "p2",
          gamePointsByPlayer: { p1: 60, p2: 11 },
          declarationPointsByPlayer: { p1: 0, p2: 0 },
          totalPointsByPlayer: { p1: 60, p2: 11 },
          handScoreByPlayer: { p1: 6, p2: 1 },
          schusterPlayerIds: [],
          callerFell: false,
          callerFellOnGame: false,
          isMus: false,
          lastTrickWinnerPlayerId: "p1",
        },
      });

      act(() => {
        vi.advanceTimersByTime(2_000);
      });

      const firstCardRow = screen.getAllByTestId("belot-result-card-row")[0];

      expect(
        within(firstCardRow)
          .getAllByRole("img")
          .map((img) => img.getAttribute("alt")),
      ).toEqual([
        "VII of Acorns",
        "A of Acorns",
        "IX of Acorns",
        "U of Acorns",
        "U of Hearts",
        "O of Hearts",
        "K of Hearts",
        "X of Hearts",
      ]);
    } finally {
      vi.useRealTimers();
    }
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
    } satisfies BelotPublicState;

    renderTable(playedDeclaration);

    const group = screen.getByText("150 bonus pts").parentElement!;
    const declarationCards = within(group).getAllByRole("img");

    expect(declarationCards.map((img) => img.getAttribute("alt"))).toEqual([
      "IX of Acorns",
      "IX of Bells",
      "IX of Hearts",
      "IX of Leaves",
    ]);
    expect(
      within(group).getByAltText("IX of Bells").closest(".opacity-45"),
    ).not.toBeNull();
  });

  it("keeps the current trick area mounted when trick play has no cards", () => {
    renderTable({
      ...baseState,
      currentTrick: [],
      completedTricks: [],
    });

    const currentTrick = screen.getByTestId("belot-current-trick");

    expect(
      within(currentTrick).queryByText("Current trick"),
    ).not.toBeInTheDocument();
    expect(currentTrick.querySelector(".h-\\[138px\\]")).toBeInTheDocument();
  });

  it("shows trump selection logs in the current trick area", () => {
    renderTable(
      {
        ...baseState,
        phase: "trump-round-one",
        trumpSuit: undefined,
        callerPlayerId: undefined,
        trumpTurnPlayerId: "p2",
        trumpPasses: ["p1"],
        currentTurnPlayerId: undefined,
        currentTrick: [],
        completedTricks: [],
      },
      "p2",
    );

    const currentTrick = screen.getByTestId("belot-current-trick");

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
        "You are deciding whether to accept the upcard suit.",
      ),
    ).toBeInTheDocument();
  });

  it("shows details during trump selection", () => {
    renderTable({
      ...baseState,
      phase: "trump-round-one",
      trumpSuit: undefined,
      callerPlayerId: undefined,
      trumpTurnPlayerId: "p2",
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
    });

    expect(screen.getByTestId("belot-played-tricks")).toBeInTheDocument();
    expect(screen.getByTestId("belot-game-timeline")).toBeInTheDocument();
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

    const currentTrick = screen.getByTestId("belot-current-trick");

    expect(
      within(currentTrick).getByText("Both players passed twice."),
    ).toBeInTheDocument();
    expect(
      within(currentTrick).getByText("You are on mus and must choose trump."),
    ).toBeInTheDocument();
  });

  it("renders hand and current trick cards at the source image size", () => {
    renderTable({
      ...baseState,
      currentTrick: [{ playerId: "p2", card: card("K", "hearts") }],
      completedTricks: [],
    });

    const currentTrick = screen.getByTestId("belot-current-trick");

    expect(within(currentTrick).getByAltText("K of Hearts")).toHaveClass(
      "h-[114px]",
      "w-[71px]",
    );
    expect(
      within(screen.getAllByTestId("belot-hand-card")[0]).getByRole("img"),
    ).toHaveClass("h-[114px]", "w-[71px]");
  });

  it("keeps the upcard at declared-card size while reserving trump marker space", () => {
    renderTable({
      ...baseState,
      phase: "trump-round-one",
      trumpSuit: undefined,
      callerPlayerId: undefined,
      trumpTurnPlayerId: "p2",
      currentTurnPlayerId: undefined,
      currentTrick: [],
      completedTricks: [],
    });

    const upcard = screen.getByAltText("K of Leaves");
    const upcardPanel = upcard.closest(".belot-center-upcard");

    expect(upcard).toHaveClass("h-24", "w-16");
    expect(upcardPanel?.querySelector(".belot-card-marker-row")).not.toBeNull();
  });

  it("lightly shadows losing played cards in the current trick area", () => {
    renderTable({
      ...baseState,
      currentTrick: [
        { playerId: "p1", card: card("VII", "acorns") },
        { playerId: "p2", card: card("A", "acorns") },
      ],
      completedTricks: [],
    });

    const currentTrick = screen.getByTestId("belot-current-trick");

    expect(
      within(currentTrick).getByAltText("VII of Acorns").closest(".opacity-75"),
    ).not.toBeNull();
    expect(
      within(currentTrick).getByAltText("A of Acorns").closest(".opacity-75"),
    ).toBeNull();
  });

  it("shows played tricks and highlights the trick winner's card", () => {
    renderTable();

    const hand = screen.getByText("Trick 1 · Bob").parentElement!;

    expect(
      within(hand).getByAltText("A of Acorns").closest(".opacity-45"),
    ).toBeNull();
    expect(
      within(hand).getByAltText("VII of Acorns").closest(".opacity-45"),
    ).not.toBeNull();
  });

  it("shows completed tricks from last to first with separators", () => {
    renderTable({
      ...baseState,
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
    });

    const trickTwo = screen.getByText("Trick 2 · Bob");
    const trickOne = screen.getByText("Trick 1 · Alice");

    expect(
      trickTwo.compareDocumentPosition(trickOne) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.getAllByTestId("belot-played-trick-separator")).toHaveLength(
      1,
    );
    expect(screen.getByTestId("belot-details-separator")).toBeInTheDocument();
  });

  it("shows the game timeline beside played tricks", () => {
    renderTable({
      ...baseState,
      players: baseState.players.map((player) =>
        player.playerId === "p1"
          ? { ...player, totalScore: 184 }
          : { ...player, totalScore: 92 },
      ),
      dealerPlayerId: "p1",
      handResults: [
        {
          dealerPlayerId: "p2",
          callerPlayerId: "p1",
          opponentPlayerId: "p2",
          trumpSuit: "hearts",
          gamePointsByPlayer: { p1: 84, p2: 78 },
          declarationPointsByPlayer: { p1: 50, p2: 0 },
          totalPointsByPlayer: { p1: 134, p2: 78 },
          handScoreByPlayer: { p1: 84, p2: 20 },
          schusterPlayerIds: [],
          callerFell: false,
          callerFellOnGame: false,
          isMus: false,
          lastTrickWinnerPlayerId: "p1",
        },
        {
          dealerPlayerId: "p1",
          callerPlayerId: "p2",
          opponentPlayerId: "p1",
          trumpSuit: "leaves",
          gamePointsByPlayer: { p1: 10, p2: 152 },
          declarationPointsByPlayer: { p1: 0, p2: 20 },
          totalPointsByPlayer: { p1: 10, p2: 172 },
          handScoreByPlayer: { p1: 10, p2: 91 },
          schusterPlayerIds: [],
          callerFell: false,
          callerFellOnGame: false,
          isMus: true,
          lastTrickWinnerPlayerId: "p2",
        },
      ],
    });

    const timeline = screen.getByTestId("belot-game-timeline");
    const rows = within(timeline).getAllByTestId("belot-game-timeline-row");

    expect(
      within(timeline)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Hand", "Bob", "Alice"]);
    expect(
      within(timeline).getByRole("columnheader", { name: "Bob" }),
    ).toHaveClass("font-bold", "text-white");
    expect(
      within(timeline).getByRole("columnheader", { name: "Alice" }),
    ).toHaveClass("font-bold", "text-white");
    expect(rows).toHaveLength(2);
    expect(within(timeline).getByAltText("Hearts")).toBeInTheDocument();
    expect(within(timeline).getByAltText("Leaves")).toBeInTheDocument();
    expect(within(timeline).getByText("50 bonus")).toBeInTheDocument();
    expect(within(timeline).getByText("20 bonus")).toBeInTheDocument();
    expect(rows[1]).toHaveClass("border-b", "border-white/15");
    expect(within(rows[1]).getByText("Mus")).not.toHaveClass("font-bold");
    expect(within(rows[1]).getByText("Mus")).toHaveClass("text-white");
    expect(within(rows[1]).getByText("Mus")).not.toHaveClass("text-yellow-200");
    expect(
      within(rows[1])
        .getByText("Mus")
        .compareDocumentPosition(within(rows[1]).getByAltText("Leaves")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(within(timeline).getByText("184")).toBeInTheDocument();
    expect(within(timeline).getByText("92")).toBeInTheDocument();
  });

  it("shows played tricks before the first trick has completed", () => {
    renderTable({
      ...baseState,
      currentTrick: [],
      completedTricks: [],
    });

    expect(
      screen.queryByRole("button", { name: "Show details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hide details" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("belot-played-tricks")).toBeInTheDocument();
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

    expect(screen.getAllByText("184")).not.toHaveLength(0);
    expect(screen.getAllByText("92")).not.toHaveLength(0);
  });

  it("bolds the caller label and shows mus in player sections", () => {
    renderTable({
      ...baseState,
      isMus: true,
    });

    const callerLabel = screen.getByText("CALLER (MUS)");

    expect(callerLabel).toHaveClass("font-bold");
    expect(callerLabel).toHaveClass("text-yellow-300");
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
    } as BelotPublicState;

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

    expect(screen.getAllByTestId("belot-declaration-group")).toHaveLength(2);
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
      "belot-declaration-group",
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
