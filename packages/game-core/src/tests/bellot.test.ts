import type { Card, Rank, Suit } from "@card-games/shared";
import { describe, expect, it } from "vitest";

import type { BellotState } from "../games/bellot";
import {
  applyBellotAction,
  autoSelectBellotDeclarations,
  bellotCardPoints,
  bellotCpuCheapSearchCard,
  bellotCpuMonteCarloSampleLimit,
  bellotCpuOrderCardsForSearch,
  bellotCpuOrderRootCardsForSearch,
  bellotCpuSearchCards,
  bellotCpuTrumpMonteCarloSamples,
  calculateBellotHandResult,
  chooseBellotCpuAction,
  compareBellotCards,
  createBellotInitialState,
  defaultBellotCpuMaxSearchPlies,
  getBellotPublicState,
  inferBellotCpuImpossibleOpponentCardIds,
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

function seededRng(seed: number) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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

  it("publishes pickup card ids only to the owner after pickup", () => {
    const state = readyState();
    const firstPlayer = state.players.find(
      (player) => player.playerId === state.trumpTurnPlayerId,
    )!;
    const firstPickupCardIds = firstPlayer.hiddenCards.map((card) => card.id);
    const publicBeforePickup = getBellotPublicState(
      state,
      firstPlayer.playerId,
    );
    const firstPublicBeforePickup = publicBeforePickup.players.find(
      (player) => player.playerId === firstPlayer.playerId,
    )!;

    expect(firstPublicBeforePickup.pickupCardIds).toBeUndefined();
    expect(
      firstPublicBeforePickup.hand?.some((card) =>
        firstPickupCardIds.includes(card.id),
      ),
    ).toBe(false);

    const afterPickup = applyBellotAction(state, {
      type: "trump-accept-upcard",
      playerId: firstPlayer.playerId,
    });
    const publicForOwner = getBellotPublicState(
      afterPickup,
      firstPlayer.playerId,
    );
    const opponentPlayerId = afterPickup.players.find(
      (player) => player.playerId !== firstPlayer.playerId,
    )!.playerId;
    const publicForOpponent = getBellotPublicState(
      afterPickup,
      opponentPlayerId,
    );

    expect(
      publicForOwner.players.find(
        (player) => player.playerId === firstPlayer.playerId,
      )?.pickupCardIds,
    ).toEqual(firstPickupCardIds);
    expect(
      publicForOpponent.players.find(
        (player) => player.playerId === firstPlayer.playerId,
      )?.pickupCardIds,
    ).toBeUndefined();
    expect(
      publicForOpponent.players.find(
        (player) => player.playerId === firstPlayer.playerId,
      )?.hand,
    ).toBeUndefined();

    const afterDeclarations = afterPickup.players.reduce(
      (currentState, player) =>
        applyBellotAction(currentState, {
          type: "declare",
          playerId: player.playerId,
          declarations: [],
        }),
      afterPickup,
    );
    const firstCard = afterDeclarations.players.find(
      (player) => player.playerId === firstPlayer.playerId,
    )!.hand[0]!;
    const afterFirstPlay = applyBellotAction(afterDeclarations, {
      type: "play-card",
      playerId: firstPlayer.playerId,
      cardId: firstCard.id,
    });

    expect(
      getBellotPublicState(afterFirstPlay, firstPlayer.playerId).players.find(
        (player) => player.playerId === firstPlayer.playerId,
      )?.pickupCardIds,
    ).toBeUndefined();
  });

  it("reveals pickup card ids and unused cards only with a hand result", () => {
    const state = readyState();
    const caller = state.players.find(
      (player) => player.playerId === state.trumpTurnPlayerId,
    )!;
    const opponent = state.players.find(
      (player) => player.playerId !== caller.playerId,
    )!;
    const callerPickupCardIds = caller.hiddenCards.map((card) => card.id);
    const afterPickup = applyBellotAction(state, {
      type: "trump-accept-upcard",
      playerId: caller.playerId,
    });

    expect(
      getBellotPublicState(afterPickup, opponent.playerId).players.find(
        (player) => player.playerId === caller.playerId,
      )?.pickupCardIds,
    ).toBeUndefined();
    expect(
      getBellotPublicState(afterPickup, opponent.playerId).unusedCards,
    ).toBeUndefined();

    const withHandResult: BellotState = {
      ...afterPickup,
      phase: "hand-complete",
      lastHandResult: {
        callerPlayerId: caller.playerId,
        opponentPlayerId: opponent.playerId,
        gamePointsByPlayer: { [caller.playerId]: 0, [opponent.playerId]: 0 },
        declarationPointsByPlayer: {
          [caller.playerId]: 0,
          [opponent.playerId]: 0,
        },
        totalPointsByPlayer: { [caller.playerId]: 0, [opponent.playerId]: 0 },
        handScoreByPlayer: { [caller.playerId]: 0, [opponent.playerId]: 0 },
        schusterPlayerIds: [],
        callerFell: false,
        callerFellOnGame: false,
        isMus: false,
        lastTrickWinnerPlayerId: caller.playerId,
      },
    };
    const publicHandResult = getBellotPublicState(
      withHandResult,
      opponent.playerId,
    );

    expect(publicHandResult.unusedCards).toEqual(afterPickup.unusedCards);
    expect(
      publicHandResult.players.find(
        (player) => player.playerId === caller.playerId,
      )?.pickupCardIds,
    ).toEqual(callerPickupCardIds);
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
    expect(() =>
      applyBellotAction(mus, {
        type: "trump-choose-suit",
        playerId: first,
        suit: mus.upcard!.suit,
      }),
    ).toThrow("upcard suit");

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
    expect(declarations.trumpSuit).toBe(chosenSuit);
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
    expect(bellotCardPoints(card("O", "hearts"), "hearts")).toBe(3);
    expect(bellotCardPoints(card("U", "acorns"), "hearts")).toBe(2);
    expect(bellotCardPoints(card("A", "acorns"), "hearts")).toBe(11);
    expect(
      compareBellotCards(card("U", "hearts"), card("IX", "hearts"), "hearts"),
    ).toBeGreaterThan(0);
    expect(
      compareBellotCards(card("IX", "hearts"), card("X", "hearts"), "hearts"),
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

  it("enforces follow-suit and trumping obligations without card-strength restrictions", () => {
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
        [{ playerId: "p1", card: card("A", "hearts") }],
        "hearts",
      ).map((legalCard) => legalCard.id),
    ).toEqual(["IX-hearts", "U-hearts"]);
  });

  it("publishes in-hand game points after won tricks", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("VII", "acorns")],
          hiddenCards: [],
          wonCards: [card("U", "hearts"), card("X", "acorns")],
          tricksWon: 1,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VIII", "acorns")],
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

    const publicState = getBellotPublicState(state, "p1");

    expect(publicState.players[0].gamePoints).toBe(30);
    expect(publicState.players[1].gamePoints).toBe(0);
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

  it("chooses CPU trump, declarations, and searched trick cards as normal Bellot actions", () => {
    const trumpState: BellotState = {
      ...createBellotInitialState(players),
      phase: "trump-round-one",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("U", "hearts"),
            card("IX", "hearts"),
            card("A", "hearts"),
            card("A", "acorns"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("K", "hearts"),
      trumpTurnPlayerId: "p1",
      firstPlayerId: "p1",
    };

    expect(chooseBellotCpuAction(trumpState, "p1")).toEqual({
      type: "trump-accept-upcard",
      playerId: "p1",
    });

    const declarationState: BellotState = {
      ...trumpState,
      phase: "declarations",
      trumpSuit: "hearts",
      trumpTurnPlayerId: undefined,
      players: trumpState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("O", "hearts"),
                card("K", "hearts"),
                card("A", "acorns"),
              ],
            }
          : player,
      ),
    };
    const declarationAction = chooseBellotCpuAction(declarationState, "p1");

    expect(declarationAction?.type).toBe("declare");
    expect(
      declarationAction?.type === "declare"
        ? declarationAction.declarations.map((declaration) => declaration.type)
        : [],
    ).toContain("BELOTE");

    const trickState: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns"), card("VII", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("U", "hearts"), card("A", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("X", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      chooseBellotCpuAction(trickState, "p1", {
        monteCarloSamples: 1,
        maxSearchPlies: 2,
        rng: () => 0.5,
      }),
    ).toEqual({
      type: "play-card",
      playerId: "p1",
      cardId: "A-acorns",
    });
  });

  it("increases CPU Monte Carlo samples by 20 percent per missing trick card", () => {
    expect(bellotCpuMonteCarloSampleLimit(64, 10)).toBe(64);
    expect(bellotCpuMonteCarloSampleLimit(64, 9)).toBe(77);
    expect(bellotCpuMonteCarloSampleLimit(64, 6)).toBe(116);
  });

  it("uses the same 14-ply default CPU search for trump and trick play", () => {
    expect(defaultBellotCpuMaxSearchPlies).toBe(14);
  });

  it("orders CPU search cards from the correct alpha-beta perspective", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "acorns"),
            card("X", "acorns"),
            card("A", "acorns"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("K", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuOrderCardsForSearch(state.players[0].hand, state, true).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns", "X-acorns", "VII-acorns"]);
    expect(
      bellotCpuOrderCardsForSearch(state.players[0].hand, state, false).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns", "X-acorns", "VII-acorns"]);
  });

  it("orders root CPU cards by previous Monte Carlo sample success", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "acorns"),
            card("X", "acorns"),
            card("A", "acorns"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("K", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };
    const stats = new Map([
      [
        "A-acorns",
        {
          sampleCount: 4,
          successCount: 1,
          totalWinningValue: 120,
        },
      ],
      [
        "X-acorns",
        {
          sampleCount: 4,
          successCount: 3,
          totalWinningValue: 80,
        },
      ],
      [
        "VII-acorns",
        {
          sampleCount: 4,
          successCount: 1,
          totalWinningValue: 20,
        },
      ],
    ]);

    expect(
      bellotCpuOrderRootCardsForSearch(state.players[0].hand, state, stats).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["X-acorns", "A-acorns", "VII-acorns"]);
  });

  it("uses 50 percent more regular CPU Monte Carlo samples when selecting trump", () => {
    expect(bellotCpuTrumpMonteCarloSamples()).toBe(96);
    expect(bellotCpuTrumpMonteCarloSamples({ monteCarloSamples: 10 })).toBe(15);
    expect(
      bellotCpuTrumpMonteCarloSamples({
        monteCarloSamples: 10,
        trumpMonteCarloSamples: 7,
      }),
    ).toBe(7);
  });

  it("uses cheap Bellot search moves for distant rollout plies", () => {
    const respondingState: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("X", "acorns"), card("A", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("K", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuCheapSearchCard(respondingState.players[0].hand, respondingState)
        .id,
    ).toBe("A-acorns");

    const aceOnlyWinningResponseState: BellotState = {
      ...respondingState,
      players: respondingState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [card("K", "acorns"), card("A", "acorns")],
            }
          : player,
      ),
      currentTrick: [{ playerId: "p2", card: card("O", "acorns") }],
    };

    expect(
      bellotCpuCheapSearchCard(
        aceOnlyWinningResponseState.players[0].hand,
        aceOnlyWinningResponseState,
      ).id,
    ).toBe("K-acorns");

    const tenOnlyWinningResponseState: BellotState = {
      ...respondingState,
      players: respondingState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [card("U", "acorns"), card("X", "acorns")],
            }
          : player,
      ),
      currentTrick: [{ playerId: "p2", card: card("IX", "acorns") }],
    };

    expect(
      bellotCpuCheapSearchCard(
        tenOnlyWinningResponseState.players[0].hand,
        tenOnlyWinningResponseState,
      ).id,
    ).toBe("X-acorns");

    const losingResponseState: BellotState = {
      ...respondingState,
      players: respondingState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [card("VII", "acorns"), card("O", "acorns")],
            }
          : player,
      ),
      currentTrick: [{ playerId: "p2", card: card("A", "acorns") }],
    };

    expect(
      bellotCpuCheapSearchCard(
        losingResponseState.players[0].hand,
        losingResponseState,
      ).id,
    ).toBe("VII-acorns");

    const leadingState: BellotState = {
      ...respondingState,
      players: respondingState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("VII", "hearts"),
                card("U", "hearts"),
                card("X", "bells"),
                card("A", "acorns"),
              ],
            }
          : player.playerId === "p2"
            ? {
                ...player,
                hand: [card("VII", "bells")],
              }
            : player,
      ),
      currentTrick: [],
    };

    expect(
      bellotCpuCheapSearchCard(leadingState.players[0].hand, leadingState).id,
    ).toBe("X-bells");

    const equalOrMoreTrumpLeadState: BellotState = {
      ...leadingState,
      players: leadingState.players.map((player) =>
        player.playerId === "p2"
          ? {
              ...player,
              hand: [card("IX", "hearts"), card("X", "hearts")],
            }
          : player,
      ),
    };

    expect(
      bellotCpuCheapSearchCard(
        equalOrMoreTrumpLeadState.players[0].hand,
        equalOrMoreTrumpLeadState,
      ).id,
    ).toBe("A-acorns");

    const fewerTrumpLeadState: BellotState = {
      ...equalOrMoreTrumpLeadState,
      players: equalOrMoreTrumpLeadState.players.map((player) =>
        player.playerId === "p2"
          ? {
              ...player,
              hand: [card("IX", "hearts")],
            }
          : player,
      ),
    };

    expect(
      bellotCpuCheapSearchCard(
        fewerTrumpLeadState.players[0].hand,
        fewerTrumpLeadState,
      ).id,
    ).toBe("U-hearts");

    const trumpOnlyLeadState: BellotState = {
      ...leadingState,
      players: leadingState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [card("VII", "hearts"), card("U", "hearts")],
            }
          : player,
      ),
    };

    expect(
      bellotCpuCheapSearchCard(
        trumpOnlyLeadState.players[0].hand,
        trumpOnlyLeadState,
      ).id,
    ).toBe("U-hearts");
  });

  it.skip("plays VIII hearts from the screenshot trick-two lead in at least three of five CPU probes", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          displayName: "CPU",
          ready: true,
          hand: [
            card("VII", "acorns"),
            card("VIII", "acorns"),
            card("O", "acorns"),
            card("K", "acorns"),
            card("IX", "bells"),
            card("K", "bells"),
            card("VIII", "hearts"),
            card("VIII", "leaves"),
            card("A", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [card("A", "hearts"), card("K", "hearts")],
          tricksWon: 1,
          totalScore: 0,
        },
        {
          ...players[1],
          displayName: "Dragan",
          ready: true,
          hand: [
            card("X", "bells"),
            card("VIII", "acorns"),
            card("U", "hearts"),
            card("X", "hearts"),
            card("VII", "hearts"),
            card("K", "leaves"),
            card("X", "leaves"),
            card("O", "acorns"),
            card("IX", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("U", "acorns"),
      trumpSuit: "leaves",
      callerPlayerId: "p1",
      firstPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("A", "hearts") },
            { playerId: "p2", card: card("K", "hearts") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };
    const rngSeeds = [13, 31, 47, 69, 83];
    const playedCardIds: string[] = [];
    let eightHeartsCount = 0;

    for (const rngSeed of rngSeeds) {
      const action = chooseBellotCpuAction(state, "p1", {
        maxSearchPlies: defaultBellotCpuMaxSearchPlies,
        rng: seededRng(rngSeed),
      });

      if (action?.type !== "play-card") {
        throw new Error("CPU did not choose a card to play");
      }

      playedCardIds.push(action.cardId);

      if (action.cardId === "VIII-hearts") {
        eightHeartsCount += 1;

        if (eightHeartsCount >= 3) {
          return;
        }
      }
    }

    expect(eightHeartsCount, playedCardIds.join(", ")).toBeGreaterThanOrEqual(
      3,
    );
  });

  it.skip("plays X leaves from the screenshot trick-three response in at least three of five CPU probes", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          displayName: "CPU",
          ready: true,
          hand: [
            card("X", "acorns"),
            card("O", "acorns"),
            card("VII", "bells"),
            card("VIII", "bells"),
            card("VIII", "hearts"),
            card("O", "hearts"),
            card("X", "leaves"),
            card("U", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [card("U", "bells"), card("O", "bells")],
          tricksWon: 1,
          totalScore: 0,
        },
        {
          ...players[1],
          displayName: "Dragan",
          ready: true,
          hand: [
            card("IX", "bells"),
            card("U", "acorns"),
            card("K", "bells"),
            card("A", "bells"),
            card("VII", "hearts"),
            card("K", "hearts"),
            card("VII", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [card("K", "leaves"), card("A", "leaves")],
          tricksWon: 1,
          totalScore: 0,
        },
      ],
      upcard: card("IX", "bells"),
      trumpSuit: "bells",
      callerPlayerId: "p2",
      firstPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("VIII", "leaves") }],
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("U", "bells") },
            { playerId: "p2", card: card("O", "bells") },
          ],
        },
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p1", card: card("K", "leaves") },
            { playerId: "p2", card: card("A", "leaves") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };
    const rngSeeds = [3, 5, 6, 8, 11];
    const playedCardIds: string[] = [];
    let tenLeavesCount = 0;

    for (const rngSeed of rngSeeds) {
      const action = chooseBellotCpuAction(state, "p1", {
        maxSearchPlies: defaultBellotCpuMaxSearchPlies,
        monteCarloSamples: 8,
        rng: seededRng(rngSeed),
      });

      if (action?.type !== "play-card") {
        throw new Error("CPU did not choose a card to play");
      }

      playedCardIds.push(action.cardId);

      if (action.cardId === "X-leaves") {
        tenLeavesCount += 1;

        if (tenLeavesCount >= 3) {
          return;
        }
      }
    }

    expect(tenLeavesCount, playedCardIds.join(", ")).toBeGreaterThanOrEqual(3);
  });

  it("searches only the endpoints of strength-connected non-trump card ranges", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "hearts"),
            card("VIII", "hearts"),
            card("IX", "hearts"),
            card("X", "hearts"),
            card("U", "hearts"),
            card("O", "hearts"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("A", "acorns"),
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "X-hearts", "O-hearts"]);
  });

  it("searches only the cheapest losing response card per suit", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "acorns"),
            card("IX", "acorns"),
            card("X", "acorns"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("K", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-acorns", "X-acorns"]);
  });

  it("prunes same-suit losing responses before the small search-card return", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("VII", "acorns"), card("IX", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("K", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-acorns"]);
  });

  it("searches only the higher connected endpoint when both response endpoints win", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("X", "acorns"), card("A", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("K", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns"]);
  });

  it("keeps existing winning response evaluations for an unsupported non-trump ace", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("K", "acorns"), card("A", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("O", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["K-acorns", "A-acorns"]);
  });

  it("searches only the non-trump ace when the ten has already been played", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("K", "acorns"), card("A", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("O", "acorns") }],
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("X", "acorns") },
            { playerId: "p2", card: card("VII", "acorns") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns"]);
  });

  it("searches only the non-trump ten when it can win and the ace is unavailable", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("U", "acorns"), card("X", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("IX", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["X-acorns"]);
  });

  it("keeps both connected response endpoints when only one endpoint wins", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("O", "acorns"), card("X", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("K", "acorns") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["O-acorns", "X-acorns"]);
  });

  it("searches only the endpoints of a full non-trump suit range", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "hearts"),
            card("VIII", "hearts"),
            card("IX", "hearts"),
            card("X", "hearts"),
            card("U", "hearts"),
            card("O", "hearts"),
            card("K", "hearts"),
            card("A", "hearts"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "A-hearts"]);
  });

  it("uses played cards and the upcard to bridge non-trump search ranges", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "hearts"),
            card("IX", "hearts"),
            card("U", "hearts"),
            card("O", "hearts"),
            card("X", "hearts"),
            card("A", "hearts"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("K", "hearts"),
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      completedTricks: [
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p1", card: card("VIII", "hearts") },
            { playerId: "p2", card: card("A", "acorns") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "A-hearts"]);
  });

  it("searches trump connected ranges in trump strength order", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("A", "hearts"),
            card("IX", "hearts"),
            card("U", "hearts"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-hearts", "U-hearts"]);
  });

  it("searches only the endpoints of a full trump suit range", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "hearts"),
            card("VIII", "hearts"),
            card("IX", "hearts"),
            card("X", "hearts"),
            card("U", "hearts"),
            card("O", "hearts"),
            card("K", "hearts"),
            card("A", "hearts"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "U-hearts"]);
  });

  it("uses played cards and the upcard to bridge trump search ranges", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "hearts"),
            card("O", "hearts"),
            card("K", "hearts"),
            card("A", "hearts"),
            card("IX", "hearts"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("X", "hearts"),
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      completedTricks: [
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p1", card: card("VIII", "hearts") },
            { playerId: "p2", card: card("A", "acorns") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      bellotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "IX-hearts"]);
  });

  it("gates voluntary CPU trump calls by rollout success rate", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trump-round-one",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "hearts"), card("X", "hearts")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("U", "hearts"),
      trumpTurnPlayerId: "p1",
      firstPlayerId: "p1",
    };

    expect(
      chooseBellotCpuAction(state, "p1", {
        trumpMinSuccessRate: Number.POSITIVE_INFINITY,
        trumpMinExpectedValue: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({
      type: "trump-pass",
      playerId: "p1",
    });

    expect(
      chooseBellotCpuAction(state, "p1", {
        trumpMinSuccessRate: 0,
        trumpMinExpectedValue: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({
      type: "trump-accept-upcard",
      playerId: "p1",
    });

    expect(
      chooseBellotCpuAction(state, "p1", {
        trumpMinSuccessRate: 0,
        trumpHighSuccessRate: Number.POSITIVE_INFINITY,
        trumpMinExpectedValue: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({
      type: "trump-pass",
      playerId: "p1",
    });

    expect(
      chooseBellotCpuAction(
        {
          ...state,
          players: state.players.map((player) =>
            player.playerId === "p1"
              ? {
                  ...player,
                  hand: [
                    card("A", "hearts"),
                    card("X", "hearts"),
                    card("K", "hearts"),
                  ],
                }
              : player,
          ),
        },
        "p1",
        {
          trumpMinSuccessRate: 0,
          trumpHighSuccessRate: Number.POSITIVE_INFINITY,
          trumpMinExpectedValue: Number.NEGATIVE_INFINITY,
        },
      ),
    ).toEqual({
      type: "trump-accept-upcard",
      playerId: "p1",
    });
  });

  it("allows the CPU to pass the second trump round but still choose on mus", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trump-round-two",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("VII", "acorns"), card("VIII", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VII", "leaves"), card("VIII", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("A", "hearts"),
      trumpTurnPlayerId: "p2",
      firstPlayerId: "p1",
      trumpRound: 2,
      trumpPasses: ["p1"],
    };
    const action = chooseBellotCpuAction(state, "p2", {
      trumpMinSuccessRate: Number.POSITIVE_INFINITY,
      trumpMinExpectedValue: Number.NEGATIVE_INFINITY,
    });

    expect(action).toEqual({
      type: "trump-pass",
      playerId: "p2",
    });
    expect(applyBellotAction(state, action!).phase).toBe("mus");
    expect(
      chooseBellotCpuAction(
        {
          ...state,
          phase: "mus",
          trumpRound: 3,
          trumpPasses: [],
          trumpTurnPlayerId: "p1",
          isMus: true,
        },
        "p1",
        {
          trumpMinSuccessRate: Number.POSITIVE_INFINITY,
          trumpMinExpectedValue: Number.POSITIVE_INFINITY,
        },
      )?.type,
    ).toBe("trump-choose-suit");
  });

  it("does not use hidden pickup card identities during CPU trump selection", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trump-round-one",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "hearts")],
          hiddenCards: [card("VII", "acorns"), card("VIII", "acorns")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("VII", "hearts"),
      trumpTurnPlayerId: "p1",
      firstPlayerId: "p1",
    };
    const changedHiddenState: BellotState = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hiddenCards: [card("U", "hearts"), card("IX", "hearts")],
            }
          : player,
      ),
    };
    const options = {
      trumpMonteCarloSamples: 3,
      trumpSearchPlies: 2,
      rng: () => 0.5,
    };

    expect(chooseBellotCpuAction(changedHiddenState, "p1", options)).toEqual(
      chooseBellotCpuAction(state, "p1", options),
    );
  });

  it("does not use hidden pickup cards or the actual opponent hand during CPU trump rollouts", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trump-round-two",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("U", "hearts"), card("IX", "hearts")],
          hiddenCards: [card("VII", "acorns"), card("VIII", "acorns")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("A", "bells"), card("X", "bells")],
          hiddenCards: [card("K", "bells"), card("O", "bells")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("VII", "leaves"),
      trumpTurnPlayerId: "p1",
      firstPlayerId: "p1",
    };
    const changedHiddenState: BellotState = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hiddenCards: [card("A", "hearts"), card("X", "hearts")],
            }
          : {
              ...player,
              hand: [card("VII", "hearts"), card("VIII", "hearts")],
              hiddenCards: [card("K", "hearts"), card("O", "hearts")],
            },
      ),
    };
    const options = {
      trumpMonteCarloSamples: 3,
      trumpSearchPlies: 2,
      rng: () => 0.5,
    };

    expect(chooseBellotCpuAction(changedHiddenState, "p1", options)).toEqual(
      chooseBellotCpuAction(state, "p1", options),
    );
  });

  it("does not use hidden opponent cards or the unused deck for CPU trick decisions", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns"), card("VII", "acorns")],
          hiddenCards: [],
          wonCards: [card("K", "bells")],
          tricksWon: 1,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("U", "hearts"), card("A", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      unusedCards: [card("IX", "hearts"), card("A", "hearts")],
      upcard: card("K", "hearts"),
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("X", "acorns") }],
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("K", "bells") },
            { playerId: "p2", card: card("VII", "bells") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: {
        p1: [],
        p2: [card("O", "hearts")],
      },
    };
    const changedHiddenState: BellotState = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === "p2"
          ? {
              ...player,
              hand: [card("VII", "leaves"), card("VIII", "leaves")],
            }
          : player,
      ),
      unusedCards: [card("U", "hearts"), card("A", "bells")],
    };
    const options = {
      monteCarloSamples: 3,
      maxSearchPlies: 3,
      rng: () => 0.5,
    };

    expect(chooseBellotCpuAction(changedHiddenState, "p1", options)).toEqual(
      chooseBellotCpuAction(state, "p1", options),
    );
  });

  it("extends shallow CPU searches to finish the current trick before evaluation", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns"), card("VII", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VII", "acorns"), card("VIII", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: {
        p1: [],
        p2: [card("VII", "acorns"), card("VIII", "bells")],
      },
    };

    expect(
      chooseBellotCpuAction(state, "p1", {
        maxSearchPlies: 1,
        monteCarloSamples: 1,
        rng: () => 0.5,
      }),
    ).toEqual({
      type: "play-card",
      playerId: "p1",
      cardId: "A-acorns",
    });
  });

  it("infers opponent void suits and missing trumps from public trick history", () => {
    const voidState: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 1,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VII", "leaves")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("A", "acorns") },
            { playerId: "p2", card: card("K", "bells") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };
    const voidImpossibleCards = new Set(
      inferBellotCpuImpossibleOpponentCardIds(voidState, "p2"),
    );

    for (const rank of ["VII", "VIII", "IX", "X", "U", "O", "K", "A"]) {
      expect(voidImpossibleCards.has(`${rank}-acorns`)).toBe(true);
      expect(voidImpossibleCards.has(`${rank}-hearts`)).toBe(true);
    }

    const trumpedState: BellotState = {
      ...voidState,
      completedTricks: [
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p1", card: card("A", "acorns") },
            { playerId: "p2", card: card("VII", "hearts") },
          ],
        },
      ],
    };
    const trumpedImpossibleCards = new Set(
      inferBellotCpuImpossibleOpponentCardIds(trumpedState, "p2"),
    );

    for (const rank of ["VII", "VIII", "IX", "X", "U", "O", "K", "A"]) {
      expect(trumpedImpossibleCards.has(`${rank}-acorns`)).toBe(true);
    }
    expect(trumpedImpossibleCards.has("U-hearts")).toBe(false);
    expect(trumpedImpossibleCards.has("A-hearts")).toBe(false);

    const trumpResponseState: BellotState = {
      ...voidState,
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("IX", "hearts") },
            { playerId: "p2", card: card("VII", "hearts") },
          ],
        },
      ],
    };
    const trumpResponseImpossibleCards = new Set(
      inferBellotCpuImpossibleOpponentCardIds(trumpResponseState, "p2"),
    );

    expect(trumpResponseImpossibleCards.has("U-hearts")).toBe(false);
    expect(trumpResponseImpossibleCards.has("A-hearts")).toBe(false);
  });

  it("infers cheaper same-suit cards are unavailable after costly lost responses", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("VII", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 1,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VIII", "leaves")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("A", "acorns") },
            { playerId: "p2", card: card("X", "acorns") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };
    const impossibleCards = new Set(
      inferBellotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("K-acorns")).toBe(true);
    expect(impossibleCards.has("U-acorns")).toBe(true);
    expect(impossibleCards.has("IX-acorns")).toBe(true);
    expect(impossibleCards.has("A-acorns")).toBe(false);
    expect(impossibleCards.has("K-bells")).toBe(false);
  });

  it("keeps cheaper same-suit cards possible when later play history disproves the costly response inference", () => {
    const state: BellotState = {
      ...createBellotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("VII", "bells")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 2,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VIII", "leaves")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("A", "acorns") },
            { playerId: "p2", card: card("X", "acorns") },
          ],
        },
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p2", card: card("VII", "acorns") },
            { playerId: "p1", card: card("VIII", "acorns") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };
    const impossibleCards = new Set(
      inferBellotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("K-acorns")).toBe(false);
    expect(impossibleCards.has("U-acorns")).toBe(false);
    expect(impossibleCards.has("IX-acorns")).toBe(false);
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

    const schusterWithDeclarations = calculateBellotHandResult(
      scoringState({
        callerPlayerId: "p2",
        p1WonCards: [],
        p2WonCards: [
          card("U", "hearts"),
          card("IX", "hearts"),
          card("A", "hearts"),
          card("X", "hearts"),
          card("A", "acorns"),
          card("X", "acorns"),
          card("A", "bells"),
          card("K", "acorns"),
        ],
        p1TricksWon: 0,
        p2TricksWon: 10,
        declarationsByPlayer: {
          p1: [
            {
              type: "SEQUENCE_3",
              cards: [
                card("VII", "hearts"),
                card("VIII", "hearts"),
                card("IX", "hearts"),
              ],
              points: 20,
            },
          ],
          p2: [{ type: "FOUR_OF_KIND_IX", cards: [], points: 150 }],
        },
        lastTrickWinnerPlayerId: "p2",
      }),
    );

    expect(schusterWithDeclarations.declarationPointsByPlayer.p1).toBe(20);
    expect(schusterWithDeclarations.declarationPointsByPlayer.p2).toBe(150);
    expect(schusterWithDeclarations.gamePointsByPlayer.p2).toBe(101);
    expect(schusterWithDeclarations.handScoreByPlayer.p1).toBe(-100);
    expect(schusterWithDeclarations.handScoreByPlayer.p2).toBe(271);
    expect(schusterWithDeclarations.schusterPlayerIds).toEqual(["p1"]);
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
