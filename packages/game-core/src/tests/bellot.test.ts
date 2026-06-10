import type { Card, Rank, Suit } from "@card-games/shared";
import { describe, expect, it } from "vitest";

import type { BellotState } from "../games/bellot";
import {
  applyBellotAction,
  autoSelectBellotDeclarations,
  bellotCardPoints,
  calculateBellotHandResult,
  compareBellotCards,
  createBellotInitialState,
  getBellotPublicState,
  legalBellotCards,
  validateBellotDeclarations,
} from "../index";

const players = [
  { playerId: "p1", displayName: "Player One" },
  { playerId: "p2", displayName: "Player Two" },
];

function card(rank: Rank, suit: Suit): Card {
  return { id: `${rank}-${suit}`, rank, suit };
}

function readyState() {
  return applyBellotAction(
    applyBellotAction(createBellotInitialState(players), {
      type: "set-ready",
      playerId: "p1",
      ready: true,
    }),
    { type: "set-ready", playerId: "p2", ready: true },
  );
}

function scoringState(overrides: {
  callerPlayerId?: string;
  trumpSuit?: Suit;
  isMus?: boolean;
  p1WonCards: Card[];
  p2WonCards: Card[];
  p1TricksWon: number;
  p2TricksWon: number;
  declarationsByPlayer?: BellotState["declarationsByPlayer"];
  lastTrickWinnerPlayerId?: string;
}): BellotState {
  const trumpSuit = overrides.trumpSuit ?? "hearts";

  return {
    ...createBellotInitialState(players),
    phase: "trick-play",
    players: [
      {
        ...players[0],
        ready: true,
        hand: [],
        hiddenCards: [],
        wonCards: overrides.p1WonCards,
        tricksWon: overrides.p1TricksWon,
        totalScore: 0,
      },
      {
        ...players[1],
        ready: true,
        hand: [],
        hiddenCards: [],
        wonCards: overrides.p2WonCards,
        tricksWon: overrides.p2TricksWon,
        totalScore: 0,
      },
    ],
    trumpSuit,
    callerPlayerId: overrides.callerPlayerId ?? "p1",
    isMus: overrides.isMus ?? false,
    completedTricks: [
      {
        winnerPlayerId: overrides.lastTrickWinnerPlayerId ?? "p1",
        cards: [card("VII", "acorns"), card("VIII", "acorns")].map(
          (trickCard, index) => ({
            playerId: index === 0 ? "p1" : "p2",
            card: trickCard,
          }),
        ),
      },
    ],
    declarationsByPlayer: overrides.declarationsByPlayer ?? {},
  };
}

describe("Bellot", () => {
  it("starts a two-player hand with 8-card hands, 2 hidden cards, an upcard, and unused cards", () => {
    const state = readyState();

    expect(state.phase).toBe("trump-round-one");
    expect(state.players).toHaveLength(2);
    expect(state.players[0].hand).toHaveLength(8);
    expect(state.players[1].hand).toHaveLength(8);
    expect(state.players[0].hiddenCards).toHaveLength(2);
    expect(state.players[1].hiddenCards).toHaveLength(2);
    expect(state.upcard).toBeDefined();
    expect(state.unusedCards).toHaveLength(11);
    expect(state.trumpTurnPlayerId).toBe(state.firstPlayerId);
  });

  it("runs first round, second round, and mus trump selection rules", () => {
    const firstRound = readyState();
    const first = firstRound.trumpTurnPlayerId!;
    const second = first === "p1" ? "p2" : "p1";
    const secondRound = applyBellotAction(
      applyBellotAction(firstRound, { type: "trump-pass", playerId: first }),
      { type: "trump-pass", playerId: second },
    );

    expect(secondRound.phase).toBe("trump-round-two");
    expect(secondRound.trumpTurnPlayerId).toBe(first);

    expect(() =>
      applyBellotAction(secondRound, {
        type: "trump-choose-suit",
        playerId: first,
        suit: secondRound.upcard!.suit,
      }),
    ).toThrow("upcard suit");

    const mus = applyBellotAction(
      applyBellotAction(secondRound, { type: "trump-pass", playerId: first }),
      { type: "trump-pass", playerId: second },
    );
    const chosenSuit = (["acorns", "bells", "hearts", "leaves"] as Suit[]).find(
      (suit) => suit !== mus.upcard!.suit,
    )!;
    const declarations = applyBellotAction(mus, {
      type: "trump-choose-suit",
      playerId: first,
      suit: chosenSuit,
    });

    expect(mus.phase).toBe("mus");
    expect(declarations.phase).toBe("declarations");
    expect(declarations.isMus).toBe(true);
    expect(declarations.callerPlayerId).toBe(first);
    expect(
      declarations.players.every((player) => player.hand.length === 10),
    ).toBe(true);
    expect(declarations.upcard?.suit).toBe(mus.upcard?.suit);
    expect(
      declarations.players.every((player) =>
        player.hand.every(
          (handCard) => handCard.id !== declarations.upcard?.id,
        ),
      ),
    ).toBe(true);
  });

  it("scores card points and card rank order differently for trump and non-trump suits", () => {
    expect(bellotCardPoints(card("U", "hearts"), "hearts")).toBe(20);
    expect(bellotCardPoints(card("IX", "hearts"), "hearts")).toBe(14);
    expect(bellotCardPoints(card("U", "acorns"), "hearts")).toBe(2);
    expect(bellotCardPoints(card("A", "acorns"), "hearts")).toBe(11);
    expect(
      compareBellotCards(card("U", "hearts"), card("IX", "hearts"), "hearts"),
    ).toBeGreaterThan(0);
    expect(
      compareBellotCards(card("A", "acorns"), card("X", "acorns"), "hearts"),
    ).toBeGreaterThan(0);
  });

  it("validates belote, sequences, four-of-kind declarations, and rejects impossible overlap", () => {
    const hand = [
      card("VII", "hearts"),
      card("VIII", "hearts"),
      card("IX", "hearts"),
      card("X", "hearts"),
      card("O", "hearts"),
      card("K", "hearts"),
      card("U", "acorns"),
      card("U", "bells"),
      card("U", "hearts"),
      card("U", "leaves"),
    ];

    expect(() =>
      validateBellotDeclarations({
        hand,
        trumpSuit: "hearts",
        declarations: [
          {
            type: "BELOTE",
            cards: [card("O", "hearts"), card("K", "hearts")],
            points: 20,
          },
          {
            type: "SEQUENCE_4",
            cards: [
              card("VII", "hearts"),
              card("VIII", "hearts"),
              card("IX", "hearts"),
              card("X", "hearts"),
            ],
            points: 50,
          },
          {
            type: "FOUR_JACKS",
            cards: [
              card("U", "acorns"),
              card("U", "bells"),
              card("U", "hearts"),
              card("U", "leaves"),
            ],
            points: 200,
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateBellotDeclarations({
        hand,
        trumpSuit: "hearts",
        declarations: [
          {
            type: "SEQUENCE_3",
            cards: [
              card("VII", "hearts"),
              card("VIII", "hearts"),
              card("IX", "hearts"),
            ],
            points: 20,
          },
          {
            type: "SEQUENCE_3",
            cards: [
              card("IX", "hearts"),
              card("X", "hearts"),
              card("U", "hearts"),
            ],
            points: 20,
          },
        ],
      }),
    ).toThrow("overlap");

    expect(() =>
      validateBellotDeclarations({
        hand,
        trumpSuit: "hearts",
        declarations: [
          {
            type: "FOUR_NINES",
            cards: [
              card("IX", "acorns"),
              card("IX", "bells"),
              card("IX", "hearts"),
              card("IX", "leaves"),
            ],
            points: 150,
          },
        ],
      }),
    ).toThrow("outside");

    expect(() =>
      validateBellotDeclarations({
        hand,
        trumpSuit: "hearts",
        declarations: [
          {
            type: "BELOTE",
            cards: [
              { ...card("O", "hearts"), id: "VII-hearts" },
              card("K", "hearts"),
            ],
            points: 20,
          },
        ],
      }),
    ).toThrow("does not match");
  });

  it("auto-selects the maximum valid declarations with belote overlap allowed", () => {
    const declarations = autoSelectBellotDeclarations(
      [
        card("VII", "hearts"),
        card("VIII", "hearts"),
        card("IX", "hearts"),
        card("X", "hearts"),
        card("U", "hearts"),
        card("O", "hearts"),
        card("K", "hearts"),
        card("A", "hearts"),
        card("A", "acorns"),
        card("X", "bells"),
      ],
      "hearts",
    );

    expect(declarations.map((declaration) => declaration.type)).toEqual([
      "SEQUENCE_5_PLUS",
      "BELOTE",
      "SEQUENCE_3",
    ]);
    expect(
      declarations.reduce((sum, declaration) => sum + declaration.points, 0),
    ).toBe(140);
  });

  it("waits for both players' declarations and then publishes declaration cards", () => {
    let state = readyState();
    state = applyBellotAction(state, {
      type: "trump-accept-upcard",
      playerId: state.trumpTurnPlayerId!,
    });
    const p1Declaration = {
      type: "SEQUENCE_3" as const,
      cards: state.players[0].hand
        .slice(0, 3)
        .map((_, index) =>
          card((["VII", "VIII", "IX"] as Rank[])[index], "acorns"),
        ),
      points: 20,
    };
    state = {
      ...state,
      players: state.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              hand: [...p1Declaration.cards, ...player.hand.slice(3)],
            }
          : player,
      ),
    };

    state = applyBellotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [p1Declaration],
    });
    expect(state.phase).toBe("declarations");

    state = applyBellotAction(state, {
      type: "declare",
      playerId: "p2",
      declarations: [],
    });
    const publicForP2 = getBellotPublicState(state, "p2");

    expect(state.phase).toBe("trick-play");
    expect(publicForP2.upcard).toEqual(state.upcard);
    expect(
      publicForP2.players.find((player) => player.playerId === "p1")?.hand,
    ).toBeUndefined();
    expect(
      publicForP2.players.find((player) => player.playerId === "p1")
        ?.publicCards,
    ).toHaveLength(3);
  });

  it("ignores duplicate declaration submissions from a player", () => {
    let state = readyState();
    state = applyBellotAction(state, {
      type: "trump-accept-upcard",
      playerId: state.trumpTurnPlayerId!,
    });

    state = applyBellotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [],
    });
    state = applyBellotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [],
    });

    expect(state.phase).toBe("declarations");

    state = applyBellotAction(state, {
      type: "declare",
      playerId: "p2",
      declarations: [],
    });
    state = applyBellotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [],
    });

    expect(state.phase).toBe("trick-play");
    expect(state.error).toBeUndefined();
  });

  it("enters an error phase instead of continuing after an invalid declaration", () => {
    let state = readyState();
    state = applyBellotAction(state, {
      type: "trump-accept-upcard",
      playerId: state.trumpTurnPlayerId!,
    });
    const nonTrumpSuit = (
      ["acorns", "bells", "hearts", "leaves"] as Suit[]
    ).find((suit) => suit !== state.trumpSuit)!;
    const invalidBeloteCards = [
      card("O", nonTrumpSuit),
      card("K", nonTrumpSuit),
    ];
    state = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [...invalidBeloteCards, ...player.hand.slice(2)],
            }
          : player,
      ),
    };
    state = applyBellotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [
        {
          type: "BELOTE",
          cards: invalidBeloteCards,
          points: 20,
        },
      ],
    });

    expect(state.phase).toBe("error");
    expect(state.error).toContain("belote");
  });

  it("enforces follow-suit, trumping, and overtrumping obligations", () => {
    const hand = [
      card("VII", "acorns"),
      card("A", "bells"),
      card("IX", "hearts"),
      card("U", "hearts"),
    ];

    expect(
      legalBellotCards(
        hand,
        [{ playerId: "p1", card: card("X", "acorns") }],
        "hearts",
      ).map((legalCard) => legalCard.id),
    ).toEqual(["VII-acorns"]);

    expect(
      legalBellotCards(
        hand.filter((handCard) => handCard.suit !== "acorns"),
        [{ playerId: "p1", card: card("X", "acorns") }],
        "hearts",
      ).map((legalCard) => legalCard.id),
    ).toEqual(["IX-hearts", "U-hearts"]);

    expect(
      legalBellotCards(
        hand,
        [{ playerId: "p1", card: card("IX", "hearts") }],
        "hearts",
      ).map((legalCard) => legalCard.id),
    ).toEqual(["U-hearts"]);
  });

  it("awards a trick to the strongest trump or strongest lead suit card", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VII", "hearts")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      firstPlayerId: "p1",
      declarationsByPlayer: { p1: [], p2: [] },
    };

    const finishedTrick = applyBellotAction(
      applyBellotAction(state, {
        type: "play-card",
        playerId: "p1",
        cardId: "A-acorns",
      }),
      { type: "play-card", playerId: "p2", cardId: "VII-hearts" },
    );

    expect(finishedTrick.completedTricks[0].winnerPlayerId).toBe("p2");
    expect(finishedTrick.currentTurnPlayerId).toBe("p2");
  });

  it("passes the caller when caller total is strictly greater", () => {
    const result = calculateBellotHandResult(
      scoringState({
        p1WonCards: [
          card("U", "hearts"),
          card("IX", "hearts"),
          card("A", "hearts"),
          card("X", "hearts"),
          card("A", "acorns"),
        ],
        p2WonCards: [card("A", "bells"), card("X", "bells")],
        p1TricksWon: 6,
        p2TricksWon: 4,
        declarationsByPlayer: {
          p1: [
            {
              type: "BELOTE",
              cards: [card("O", "hearts"), card("K", "hearts")],
              points: 20,
            },
          ],
          p2: [],
        },
      }),
    );

    expect(result.callerFell).toBe(false);
    expect(result.handScoreByPlayer.p1).toBe(result.totalPointsByPlayer.p1);
    expect(result.handScoreByPlayer.p2).toBe(result.totalPointsByPlayer.p2);
  });

  it("implements the caller fall scoring branches, including mus and schuster", () => {
    const fellByDeclarations = calculateBellotHandResult(
      scoringState({
        p1WonCards: [
          card("U", "hearts"),
          card("IX", "hearts"),
          card("A", "hearts"),
          card("X", "hearts"),
          card("A", "acorns"),
          card("X", "acorns"),
          card("K", "acorns"),
        ],
        p2WonCards: [card("A", "bells"), card("X", "bells")],
        p1TricksWon: 6,
        p2TricksWon: 4,
        declarationsByPlayer: {
          p1: [
            {
              type: "BELOTE",
              cards: [card("O", "hearts"), card("K", "hearts")],
              points: 20,
            },
          ],
          p2: [
            {
              type: "SEQUENCE_5_PLUS",
              cards: [
                card("VII", "bells"),
                card("VIII", "bells"),
                card("IX", "bells"),
                card("X", "bells"),
                card("U", "bells"),
              ],
              points: 100,
            },
          ],
        },
      }),
    );

    expect(fellByDeclarations.callerFell).toBe(true);
    expect(fellByDeclarations.callerFellOnGame).toBe(false);
    expect(fellByDeclarations.handScoreByPlayer.p1).toBe(0);
    expect(fellByDeclarations.handScoreByPlayer.p2).toBe(
      fellByDeclarations.totalPointsByPlayer.p2,
    );

    const fellOnGame = calculateBellotHandResult(
      scoringState({
        p1WonCards: [card("A", "acorns"), card("K", "acorns")],
        p2WonCards: [
          card("U", "hearts"),
          card("IX", "hearts"),
          card("A", "hearts"),
        ],
        p1TricksWon: 3,
        p2TricksWon: 7,
        declarationsByPlayer: {
          p1: [{ type: "SEQUENCE_4", cards: [], points: 50 }],
          p2: [{ type: "SEQUENCE_4", cards: [], points: 50 }],
        },
      }),
    );

    expect(fellOnGame.callerFellOnGame).toBe(true);
    expect(fellOnGame.handScoreByPlayer.p1).toBe(0);
    expect(fellOnGame.handScoreByPlayer.p2).toBe(
      fellOnGame.totalPointsByPlayer.p1 + fellOnGame.totalPointsByPlayer.p2,
    );

    const musSchuster = calculateBellotHandResult(
      scoringState({
        isMus: true,
        p1WonCards: [],
        p2WonCards: [
          card("U", "hearts"),
          card("IX", "hearts"),
          card("A", "hearts"),
        ],
        p1TricksWon: 0,
        p2TricksWon: 10,
        declarationsByPlayer: { p1: [], p2: [] },
        lastTrickWinnerPlayerId: "p2",
      }),
    );

    expect(musSchuster.handScoreByPlayer.p1).toBe(-120);
    expect(musSchuster.handScoreByPlayer.p2).toBe(
      musSchuster.totalPointsByPlayer.p2,
    );
    expect(musSchuster.schusterPlayerIds).toEqual(["p1"]);
  });

  it("finishes at 501 only when there is a winner after the hand", () => {
    const state: BellotState = {
      ...scoringState({
        p1WonCards: [card("A", "acorns")],
        p2WonCards: [card("VII", "bells")],
        p1TricksWon: 9,
        p2TricksWon: 1,
        lastTrickWinnerPlayerId: "p1",
      }),
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 9,
          totalScore: 500,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VII", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 1,
          totalScore: 100,
        },
      ],
      phase: "trick-play",
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      completedTricks: Array.from({ length: 9 }, () => ({
        winnerPlayerId: "p1",
        cards: [],
      })),
      declarationsByPlayer: { p1: [], p2: [] },
    };

    const finished = applyBellotAction(
      applyBellotAction(state, {
        type: "play-card",
        playerId: "p1",
        cardId: "A-acorns",
      }),
      { type: "play-card", playerId: "p2", cardId: "VII-bells" },
    );

    expect(finished.phase).toBe("finished");
    expect(finished.winnerPlayerId).toBe("p1");
  });
});
