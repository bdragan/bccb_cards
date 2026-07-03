import type { Card, Rank, Suit } from "@card-games/shared";
import { describe, expect, it } from "vitest";

import type { BelotState } from "../games/belot";
import type { BelotHandPlaySearchPolicy } from "../games/belot/hand-play-search";
import {
  belotHandPlayAlphaBetaResult,
  belotHandPlayAlphaBetaValue,
  belotHandPlaySearchMaxUtility,
  createBelotHandPlaySearchContext,
} from "../games/belot/hand-play-search";
import {
  applyBelotAction,
  autoSelectBelotDeclarations,
  belotCardPoints,
  belotCpuCheapSearchCard,
  belotCpuForcedSearchCard,
  belotCpuMonteCarloSampleLimit,
  belotCpuOrderCardsForSearch,
  belotCpuOrderRootCardsForSearch,
  belotCpuSearchCards,
  belotCpuTrumpCallExpectedValueThreshold,
  belotCpuTrumpCandidateSucceeded,
  belotCpuTrumpMonteCarloSamples,
  calculateBelotHandResult,
  chooseBelotCpuAction,
  compareBelotCards,
  createBelotInitialState,
  defaultBelotCpuMaxSearchPlies,
  getBelotPublicState,
  inferBelotCpuImpossibleOpponentCardIds,
  legalBelotCards,
  validateBelotDeclarations,
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
  return applyBelotAction(
    applyBelotAction(createBelotInitialState(players), {
      type: "set-ready",
      playerId: "p1",
      ready: true,
    }),
    { type: "set-ready", playerId: "p2", ready: true },
  );
}

function seededReadyState(seed: number) {
  const originalRandom = Math.random;
  Math.random = seededRng(seed);

  try {
    return readyState();
  } finally {
    Math.random = originalRandom;
  }
}

function scoringState(overrides: {
  callerPlayerId?: string;
  trumpSuit?: Suit;
  isMus?: boolean;
  p1WonCards: Card[];
  p2WonCards: Card[];
  p1TricksWon: number;
  p2TricksWon: number;
  declarationsByPlayer?: BelotState["declarationsByPlayer"];
  lastTrickWinnerPlayerId?: string;
}): BelotState {
  const trumpSuit = overrides.trumpSuit ?? "hearts";

  return {
    ...createBelotInitialState(players),
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

describe("Belot", () => {
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
    const publicBeforePickup = getBelotPublicState(state, firstPlayer.playerId);
    const firstPublicBeforePickup = publicBeforePickup.players.find(
      (player) => player.playerId === firstPlayer.playerId,
    )!;

    expect(firstPublicBeforePickup.pickupCardIds).toBeUndefined();
    expect(
      firstPublicBeforePickup.hand?.some((card) =>
        firstPickupCardIds.includes(card.id),
      ),
    ).toBe(false);

    const afterPickup = applyBelotAction(state, {
      type: "trump-accept-upcard",
      playerId: firstPlayer.playerId,
    });
    const publicForOwner = getBelotPublicState(
      afterPickup,
      firstPlayer.playerId,
    );
    const opponentPlayerId = afterPickup.players.find(
      (player) => player.playerId !== firstPlayer.playerId,
    )!.playerId;
    const publicForOpponent = getBelotPublicState(
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
        applyBelotAction(currentState, {
          type: "declare",
          playerId: player.playerId,
          declarations: [],
        }),
      afterPickup,
    );
    const firstCard = afterDeclarations.players.find(
      (player) => player.playerId === firstPlayer.playerId,
    )!.hand[0];
    const afterFirstPlay = applyBelotAction(afterDeclarations, {
      type: "play-card",
      playerId: firstPlayer.playerId,
      cardId: firstCard.id,
    });

    expect(
      getBelotPublicState(afterFirstPlay, firstPlayer.playerId).players.find(
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
    const afterPickup = applyBelotAction(state, {
      type: "trump-accept-upcard",
      playerId: caller.playerId,
    });

    expect(
      getBelotPublicState(afterPickup, opponent.playerId).players.find(
        (player) => player.playerId === caller.playerId,
      )?.pickupCardIds,
    ).toBeUndefined();
    expect(
      getBelotPublicState(afterPickup, opponent.playerId).unusedCards,
    ).toBeUndefined();

    const handResult = {
      dealerPlayerId: afterPickup.dealerPlayerId,
      callerPlayerId: caller.playerId,
      opponentPlayerId: opponent.playerId,
      trumpSuit: afterPickup.trumpSuit,
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
    };
    const withHandResult: BelotState = {
      ...afterPickup,
      phase: "hand-complete",
      lastHandResult: handResult,
      handResults: [handResult],
    };
    const publicHandResult = getBelotPublicState(
      withHandResult,
      opponent.playerId,
    );

    expect(publicHandResult.unusedCards).toEqual(afterPickup.unusedCards);
    expect(
      publicHandResult.players.find(
        (player) => player.playerId === caller.playerId,
      )?.pickupCardIds,
    ).toEqual(callerPickupCardIds);
    expect(publicHandResult.handResults).toEqual([handResult]);
  });

  it("runs first round, second round, and mus trump selection rules", () => {
    const firstRound = readyState();
    const first = firstRound.trumpTurnPlayerId!;
    const second = first === "p1" ? "p2" : "p1";
    const secondRound = applyBelotAction(
      applyBelotAction(firstRound, { type: "trump-pass", playerId: first }),
      { type: "trump-pass", playerId: second },
    );

    expect(secondRound.phase).toBe("trump-round-two");
    expect(secondRound.trumpTurnPlayerId).toBe(first);

    expect(() =>
      applyBelotAction(secondRound, {
        type: "trump-choose-suit",
        playerId: first,
        suit: secondRound.upcard!.suit,
      }),
    ).toThrow("upcard suit");

    const mus = applyBelotAction(
      applyBelotAction(secondRound, { type: "trump-pass", playerId: first }),
      { type: "trump-pass", playerId: second },
    );
    expect(() =>
      applyBelotAction(mus, {
        type: "trump-choose-suit",
        playerId: first,
        suit: mus.upcard!.suit,
      }),
    ).toThrow("upcard suit");

    const chosenSuit = (["acorns", "bells", "hearts", "leaves"] as Suit[]).find(
      (suit) => suit !== mus.upcard!.suit,
    )!;
    const declarations = applyBelotAction(mus, {
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
    expect(belotCardPoints(card("U", "hearts"), "hearts")).toBe(20);
    expect(belotCardPoints(card("IX", "hearts"), "hearts")).toBe(14);
    expect(belotCardPoints(card("O", "hearts"), "hearts")).toBe(3);
    expect(belotCardPoints(card("U", "acorns"), "hearts")).toBe(2);
    expect(belotCardPoints(card("A", "acorns"), "hearts")).toBe(11);
    expect(
      compareBelotCards(card("U", "hearts"), card("IX", "hearts"), "hearts"),
    ).toBeGreaterThan(0);
    expect(
      compareBelotCards(card("IX", "hearts"), card("X", "hearts"), "hearts"),
    ).toBeGreaterThan(0);
    expect(
      compareBelotCards(card("A", "acorns"), card("X", "acorns"), "hearts"),
    ).toBeGreaterThan(0);
  });

  it("starts trick play immediately when declarations are disabled", () => {
    let state = createBelotInitialState(players, {
      declarationsEnabled: false,
    });

    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: "p1",
      ready: true,
    });
    state = applyBelotAction(state, {
      type: "set-ready",
      playerId: "p2",
      ready: true,
    });

    const trumpTurnPlayerId = state.trumpTurnPlayerId!;
    const trickPlay = applyBelotAction(state, {
      type: "trump-accept-upcard",
      playerId: trumpTurnPlayerId,
    });

    expect(trickPlay.phase).toBe("trick-play");
    expect(trickPlay.currentTurnPlayerId).toBe(trickPlay.firstPlayerId);
    expect(trickPlay.declarationsByPlayer).toEqual({});
    expect(trickPlay.publicCardsByPlayer).toEqual({ p1: [], p2: [] });
    expect(trickPlay.players.every((player) => player.hand.length === 10)).toBe(
      true,
    );
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
      validateBelotDeclarations({
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
      validateBelotDeclarations({
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
      validateBelotDeclarations({
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
      validateBelotDeclarations({
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
    const declarations = autoSelectBelotDeclarations(
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
    state = applyBelotAction(state, {
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

    state = applyBelotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [p1Declaration],
    });
    expect(state.phase).toBe("declarations");

    state = applyBelotAction(state, {
      type: "declare",
      playerId: "p2",
      declarations: [],
    });
    const publicForP2 = getBelotPublicState(state, "p2");

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
    state = applyBelotAction(state, {
      type: "trump-accept-upcard",
      playerId: state.trumpTurnPlayerId!,
    });

    state = applyBelotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [],
    });
    state = applyBelotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [],
    });

    expect(state.phase).toBe("declarations");

    state = applyBelotAction(state, {
      type: "declare",
      playerId: "p2",
      declarations: [],
    });
    state = applyBelotAction(state, {
      type: "declare",
      playerId: "p1",
      declarations: [],
    });

    expect(state.phase).toBe("trick-play");
    expect(state.error).toBeUndefined();
  });

  it("enters an error phase instead of continuing after an invalid declaration", () => {
    let state = readyState();
    state = applyBelotAction(state, {
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
    state = applyBelotAction(state, {
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
      legalBelotCards(
        hand,
        [{ playerId: "p1", card: card("X", "acorns") }],
        "hearts",
      ).map((legalCard) => legalCard.id),
    ).toEqual(["VII-acorns"]);

    expect(
      legalBelotCards(
        hand.filter((handCard) => handCard.suit !== "acorns"),
        [{ playerId: "p1", card: card("X", "acorns") }],
        "hearts",
      ).map((legalCard) => legalCard.id),
    ).toEqual(["IX-hearts", "U-hearts"]);

    expect(
      legalBelotCards(
        hand,
        [{ playerId: "p1", card: card("A", "hearts") }],
        "hearts",
      ).map((legalCard) => legalCard.id),
    ).toEqual(["IX-hearts", "U-hearts"]);
  });

  it("publishes in-hand game points after won tricks", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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

    const publicState = getBelotPublicState(state, "p1");

    expect(publicState.players[0].gamePoints).toBe(30);
    expect(publicState.players[1].gamePoints).toBe(0);
  });

  it("awards a trick to the strongest trump or strongest lead suit card", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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

    const finishedTrick = applyBelotAction(
      applyBelotAction(state, {
        type: "play-card",
        playerId: "p1",
        cardId: "A-acorns",
      }),
      { type: "play-card", playerId: "p2", cardId: "VII-hearts" },
    );

    expect(finishedTrick.completedTricks[0].winnerPlayerId).toBe("p2");
    expect(finishedTrick.currentTurnPlayerId).toBe("p2");
  });

  it("chooses CPU trump, declarations, and searched trick cards as normal Belot actions", () => {
    const trumpState: BelotState = {
      ...createBelotInitialState(players),
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
      trumpPasses: ["p2"],
    };

    expect(
      chooseBelotCpuAction(trumpState, "p1", {
        trumpMinExpectedValue: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({
      type: "trump-pass",
      playerId: "p1",
    });

    const declarationState: BelotState = {
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
    const declarationAction = chooseBelotCpuAction(declarationState, "p1");

    expect(declarationAction?.type).toBe("declare");
    expect(
      declarationAction?.type === "declare"
        ? declarationAction.declarations.map((declaration) => declaration.type)
        : [],
    ).toContain("BELOTE");

    const trickState: BelotState = {
      ...createBelotInitialState(players),
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
      chooseBelotCpuAction(trickState, "p1", {
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

  it("increases CPU Monte Carlo samples by 30 percent per missing trick card", () => {
    expect(belotCpuMonteCarloSampleLimit(64, 10)).toBe(64);
    expect(belotCpuMonteCarloSampleLimit(64, 9)).toBe(84);
    expect(belotCpuMonteCarloSampleLimit(64, 6)).toBe(141);
  });

  it("uses the same 14-ply default CPU search for trump and trick play", () => {
    expect(defaultBelotCpuMaxSearchPlies).toBe(14);
  });

  it("orders CPU search cards from the correct alpha-beta perspective", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuOrderCardsForSearch(state.players[0].hand, state, true).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns", "X-acorns", "VII-acorns"]);
    expect(
      belotCpuOrderCardsForSearch(state.players[0].hand, state, false).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns", "X-acorns", "VII-acorns"]);
  });

  it("orders trump-short leading cards by cheapest opponent-void non-trump suit first", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "bells"),
            card("A", "acorns"),
            card("X", "leaves"),
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
          hand: [
            card("VII", "acorns"),
            card("VIII", "hearts"),
            card("U", "hearts"),
          ],
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
      belotCpuOrderCardsForSearch(state.players[0].hand, state, true).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-bells", "IX-hearts", "A-acorns", "X-leaves"]);
  });

  it("forces opponent-void cheap discards when a searched response can play anything", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("A", "bells"),
            card("X", "bells"),
            card("IX", "bells"),
            card("VII", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("K", "leaves"), card("VIII", "hearts")],
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

    expect(belotCpuForcedSearchCard(state.players[0].hand, state)?.id).toBe(
      "IX-bells",
    );

    const noCheapVoidSuitDiscardState: BelotState = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("A", "bells"),
                card("X", "bells"),
                card("VII", "leaves"),
              ],
            }
          : player,
      ),
    };

    expect(
      belotCpuForcedSearchCard(
        noCheapVoidSuitDiscardState.players[0].hand,
        noCheapVoidSuitDiscardState,
      ),
    ).toBeUndefined();

    const hasTrumpState: BelotState = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [card("IX", "bells"), card("VII", "hearts")],
            }
          : player,
      ),
    };

    expect(
      belotCpuForcedSearchCard(hasTrumpState.players[0].hand, hasTrumpState),
    ).toBeUndefined();
  });

  it("forces cheap void leads when the sampled opponent has more trumps", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "hearts"),
            card("X", "bells"),
            card("A", "acorns"),
            card("K", "acorns"),
            card("VII", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [
            card("IX", "hearts"),
            card("X", "hearts"),
            card("VII", "bells"),
          ],
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

    expect(belotCpuForcedSearchCard(state.players[0].hand, state)?.id).toBe(
      "VII-leaves",
    );
    expect(belotCpuCheapSearchCard(state.players[0].hand, state).id).toBe(
      "VII-leaves",
    );

    const onlyAceOrTenVoidLeadState: BelotState = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [
                card("VII", "hearts"),
                card("X", "bells"),
                card("A", "acorns"),
              ],
            }
          : player,
      ),
    };

    expect(
      belotCpuForcedSearchCard(
        onlyAceOrTenVoidLeadState.players[0].hand,
        onlyAceOrTenVoidLeadState,
      ),
    ).toBeUndefined();
  });

  it("orders root CPU cards by previous Monte Carlo sample success", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuOrderRootCardsForSearch(state.players[0].hand, state, stats).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["X-acorns", "A-acorns", "VII-acorns"]);
  });

  it("orders tied leading root CPU cards by non-trump value before trump value", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("U", "hearts"),
            card("IX", "hearts"),
            card("K", "leaves"),
            card("X", "bells"),
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
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };
    const stats = new Map(
      state.players[0].hand.map((handCard) => [
        handCard.id,
        {
          sampleCount: 4,
          successCount: 1,
          totalWinningValue: 40,
        },
      ]),
    );

    expect(
      belotCpuOrderRootCardsForSearch(state.players[0].hand, state, stats).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns", "X-bells", "K-leaves", "U-hearts", "IX-hearts"]);
  });

  it("uses regular CPU Monte Carlo samples when selecting trump", () => {
    expect(belotCpuTrumpMonteCarloSamples()).toBe(64);
    expect(belotCpuTrumpMonteCarloSamples({ monteCarloSamples: 10 })).toBe(10);
    expect(
      belotCpuTrumpMonteCarloSamples({
        monteCarloSamples: 10,
        trumpMonteCarloSamples: 7,
      }),
    ).toBe(7);
  });

  it("uses positive hand-score delta for trump rollout success", () => {
    expect(belotCpuTrumpCandidateSucceeded({ value: 100 })).toBe(true);
    expect(belotCpuTrumpCandidateSucceeded({ value: 0 })).toBe(false);
    expect(belotCpuTrumpCandidateSucceeded({ value: -100 })).toBe(false);
    expect(
      belotCpuTrumpCandidateSucceeded({ value: 100, callerFell: true }),
    ).toBe(false);
    expect(
      belotCpuTrumpCandidateSucceeded({ value: -100, callerFell: false }),
    ).toBe(true);
    expect(belotCpuTrumpCandidateSucceeded({ value: 260 }, 250)).toBe(true);
    expect(belotCpuTrumpCandidateSucceeded({ value: 260 }, 300)).toBe(false);
  });

  it("uses cheap Belot search moves for distant rollout plies", () => {
    const respondingState: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuCheapSearchCard(respondingState.players[0].hand, respondingState)
        .id,
    ).toBe("A-acorns");

    const aceOnlyWinningResponseState: BelotState = {
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
      belotCpuCheapSearchCard(
        aceOnlyWinningResponseState.players[0].hand,
        aceOnlyWinningResponseState,
      ).id,
    ).toBe("K-acorns");

    const tenOnlyWinningResponseState: BelotState = {
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
      belotCpuCheapSearchCard(
        tenOnlyWinningResponseState.players[0].hand,
        tenOnlyWinningResponseState,
      ).id,
    ).toBe("X-acorns");

    const losingResponseState: BelotState = {
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
      belotCpuCheapSearchCard(
        losingResponseState.players[0].hand,
        losingResponseState,
      ).id,
    ).toBe("VII-acorns");

    const twoWinningTrumpResponseState: BelotState = {
      ...respondingState,
      players: respondingState.players.map((player) =>
        player.playerId === "p1"
          ? {
              ...player,
              hand: [card("VIII", "hearts"), card("K", "hearts")],
            }
          : {
              ...player,
              hand: [card("IX", "hearts")],
            },
      ),
      currentTrick: [{ playerId: "p2", card: card("A", "bells") }],
    };

    expect(
      belotCpuCheapSearchCard(
        twoWinningTrumpResponseState.players[0].hand,
        twoWinningTrumpResponseState,
      ).id,
    ).toBe("K-hearts");

    const noSuperiorOpponentTrumpResponseState: BelotState = {
      ...twoWinningTrumpResponseState,
      players: twoWinningTrumpResponseState.players.map((player) =>
        player.playerId === "p2"
          ? {
              ...player,
              hand: [card("O", "hearts")],
            }
          : player,
      ),
    };

    expect(
      belotCpuCheapSearchCard(
        noSuperiorOpponentTrumpResponseState.players[0].hand,
        noSuperiorOpponentTrumpResponseState,
      ).id,
    ).toBe("VIII-hearts");

    const leadingState: BelotState = {
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
      belotCpuCheapSearchCard(leadingState.players[0].hand, leadingState).id,
    ).toBe("X-bells");

    const equalOrMoreTrumpLeadState: BelotState = {
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
      belotCpuCheapSearchCard(
        equalOrMoreTrumpLeadState.players[0].hand,
        equalOrMoreTrumpLeadState,
      ).id,
    ).toBe("A-acorns");

    const fewerTrumpLeadState: BelotState = {
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
      belotCpuCheapSearchCard(
        fewerTrumpLeadState.players[0].hand,
        fewerTrumpLeadState,
      ).id,
    ).toBe("U-hearts");

    const trumpOnlyLeadState: BelotState = {
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
      belotCpuCheapSearchCard(
        trumpOnlyLeadState.players[0].hand,
        trumpOnlyLeadState,
      ).id,
    ).toBe("U-hearts");
  });

  it("applies forced Belot search cards before normal alpha-beta ordering", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("IX", "bells")],
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
    const policy: BelotHandPlaySearchPolicy = {
      cheapOpeningSearchPlies: 100,
      searchCards: () => {
        throw new Error("forced search cards should bypass search pruning");
      },
      orderCards: () => {
        throw new Error("forced search cards should bypass ordering");
      },
      cheapSearchCard: () => {
        throw new Error("this state should not use cheap search");
      },
      forcedSearchCard: belotCpuForcedSearchCard,
    };

    expect(() =>
      belotHandPlayAlphaBetaValue(
        state,
        "p1",
        1,
        -belotHandPlaySearchMaxUtility,
        belotHandPlaySearchMaxUtility,
        createBelotHandPlaySearchContext(1, policy),
      ),
    ).not.toThrow();
  });

  it("applies forced Belot search cards before cheap alpha-beta moves", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("VII", "leaves"), card("A", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("IX", "hearts")],
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
    const policy: BelotHandPlaySearchPolicy = {
      cheapOpeningSearchPlies: 0,
      searchCards: (cards) => cards,
      orderCards: (cards) => cards,
      cheapSearchCard: (cards, cheapState) => {
        if (cheapState.currentTurnPlayerId === "p1") {
          throw new Error("forced lead should bypass cheap search");
        }

        return cards[0];
      },
      forcedSearchCard: belotCpuForcedSearchCard,
    };

    expect(() =>
      belotHandPlayAlphaBetaValue(
        state,
        "p1",
        1,
        -belotHandPlaySearchMaxUtility,
        belotHandPlaySearchMaxUtility,
        createBelotHandPlaySearchContext(1, policy),
      ),
    ).not.toThrow();
  });

  it("fast-forwards alpha-beta when a trick leader must win all remaining sampled tricks", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns"), card("X", "acorns")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VII", "bells"), card("VIII", "bells")],
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
    const policy: BelotHandPlaySearchPolicy = {
      cheapOpeningSearchPlies: 0,
      searchCards: () => {
        throw new Error("dominant leader should bypass card search");
      },
      orderCards: () => {
        throw new Error("dominant leader should bypass card ordering");
      },
      cheapSearchCard: (cards) => cards[0],
    };

    const result = belotHandPlayAlphaBetaResult(
      state,
      "p1",
      2,
      -belotHandPlaySearchMaxUtility,
      belotHandPlaySearchMaxUtility,
      createBelotHandPlaySearchContext(2, policy),
    );

    expect(result).toEqual({ value: 131, callerFell: false });
  });

  it("reuses alpha-beta values from the Belot hand-play transposition table", () => {
    let searchCardCalls = 0;
    const policy: BelotHandPlaySearchPolicy = {
      cheapOpeningSearchPlies: 0,
      searchCards: (cards) => {
        searchCardCalls += 1;
        return cards;
      },
      orderCards: (cards) => cards,
      cheapSearchCard: (cards) => cards[0],
    };
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns"), card("X", "acorns")],
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
    const context = createBelotHandPlaySearchContext(2, policy);

    const firstValue = belotHandPlayAlphaBetaValue(
      state,
      "p1",
      2,
      -1_000_000,
      1_000_000,
      context,
    );
    const secondValue = belotHandPlayAlphaBetaValue(
      state,
      "p1",
      2,
      -1_000_000,
      1_000_000,
      context,
    );

    expect(secondValue).toBe(firstValue);
    expect(searchCardCalls).toBe(1);
    expect(context.transpositionTable.size).toBeGreaterThan(0);
  });

  it("does not bypass cheap Belot search moves through transposition hits", () => {
    let cheapSearchCardCalls = 0;
    const policy: BelotHandPlaySearchPolicy = {
      cheapOpeningSearchPlies: 0,
      searchCards: (cards) => cards,
      orderCards: (cards) => cards,
      cheapSearchCard: (cards) => {
        cheapSearchCardCalls += 1;
        return cards[0];
      },
    };
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns"), card("X", "acorns")],
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
    const context = createBelotHandPlaySearchContext(1, policy);

    belotHandPlayAlphaBetaValue(state, "p1", 1, -1_000_000, 1_000_000, context);
    belotHandPlayAlphaBetaValue(state, "p1", 1, -1_000_000, 1_000_000, context);

    expect(cheapSearchCardCalls).toBe(2);
    expect(context.transpositionTable.size).toBe(0);
  });

  it.skip("plays VIII hearts from the screenshot trick-two lead in at least three of five CPU probes", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
            card("X", "acorns"),
            card("VIII", "bells"),
            card("U", "bells"),
            card("A", "bells"),
            card("X", "hearts"),
            card("VII", "leaves"),
            card("IX", "leaves"),
            card("U", "leaves"),
            card("K", "leaves"),
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
      const action = chooseBelotCpuAction(state, "p1", {
        maxSearchPlies: defaultBelotCpuMaxSearchPlies,
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

  it("plays X leaves from the screenshot trick-three response in at least three of five CPU probes", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      const action = chooseBelotCpuAction(state, "p1", {
        maxSearchPlies: defaultBelotCpuMaxSearchPlies,
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
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "X-hearts", "O-hearts"]);
  });

  it("keeps losing response cards in normal search", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-acorns", "IX-acorns", "X-acorns"]);
  });

  it("keeps same-suit losing responses before the small search-card return", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-acorns", "IX-acorns"]);
  });

  it("searches only the cheapest losing trump response per suit", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("VII", "leaves"), card("A", "leaves")],
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
      trumpSuit: "leaves",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("U", "leaves") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-leaves"]);
  });

  it("searches only the cheapest losing off-suit discard per suit", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("A", "hearts"),
            card("VII", "hearts"),
            card("X", "leaves"),
            card("IX", "leaves"),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "IX-leaves"]);
  });

  it("searches only the higher connected endpoint when both response endpoints win", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns"]);
  });

  it("keeps existing winning response evaluations for an unsupported non-trump ace", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["K-acorns", "A-acorns"]);
  });

  it("searches only the non-trump ace when the ten has already been played", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-acorns"]);
  });

  it("searches only the non-trump ten when it can win and the ace is unavailable", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["X-acorns"]);
  });

  it("discards trump ace instead of trump nine when both lose to trump jack", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "leaves"), card("IX", "leaves")],
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
      trumpSuit: "leaves",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [{ playerId: "p2", card: card("U", "leaves") }],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-leaves"]);
    expect(belotCpuCheapSearchCard(state.players[0].hand, state).id).toBe(
      "A-leaves",
    );
  });

  it("keeps both connected response endpoints when only one endpoint wins", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["O-acorns", "X-acorns"]);
  });

  it("searches only the endpoints of a full non-trump suit range", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "A-hearts"]);
  });

  it("keeps only the strongest lead in a sampled suit the opponent cannot take", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "bells"),
            card("X", "bells"),
            card("A", "bells"),
            card("VII", "leaves"),
            card("A", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
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
      unusedCards: [card("VII", "acorns")],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-bells", "VII-leaves", "A-leaves"]);
  });

  it("keeps only the cheapest non-trump lead in a sampled suit the opponent must trump", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "bells"),
            card("X", "bells"),
            card("A", "bells"),
            card("VII", "leaves"),
            card("A", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VII", "hearts"), card("VIII", "leaves")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      unusedCards: [card("VII", "acorns")],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-bells", "VII-leaves", "A-leaves"]);
  });

  it("keeps only the cheapest non-trump lead when every sampled follow-suit card wins", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "bells"),
            card("VIII", "bells"),
            card("VII", "leaves"),
            card("A", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("IX", "bells"), card("VIII", "leaves")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      unusedCards: [card("VII", "acorns")],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-bells", "VII-leaves", "A-leaves"]);
  });

  it("keeps only the strongest non-trump lead when every sampled follow-suit card loses", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("K", "bells"),
            card("A", "bells"),
            card("VII", "leaves"),
            card("A", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("O", "bells"), card("VIII", "leaves")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      unusedCards: [card("VII", "acorns")],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-bells", "VII-leaves", "A-leaves"]);
  });

  it("keeps only the cheapest trump lead when every sampled opponent trump wins", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VII", "hearts"),
            card("VIII", "hearts"),
            card("VII", "leaves"),
            card("A", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("O", "hearts"), card("VIII", "leaves")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      unusedCards: [card("VII", "acorns")],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "VII-leaves", "A-leaves"]);
  });

  it("keeps only the strongest trump lead when every sampled opponent trump loses", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("IX", "hearts"),
            card("U", "hearts"),
            card("VII", "leaves"),
            card("A", "leaves"),
          ],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("A", "hearts"), card("VIII", "leaves")],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      unusedCards: [card("VII", "acorns")],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["U-hearts", "VII-leaves", "A-leaves"]);
  });

  it("uses played cards and the upcard to bridge non-trump search ranges", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "A-hearts"]);
  });

  it("uses unused sample cards to bridge non-trump search ranges", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      unusedCards: [card("VIII", "hearts"), card("K", "hearts")],
      trumpSuit: "bells",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      currentTrick: [],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };

    expect(
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "A-hearts"]);
  });

  it("searches trump connected ranges in trump strength order", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["A-hearts", "U-hearts"]);
  });

  it("searches only the endpoints of a full trump suit range", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "U-hearts"]);
  });

  it("uses played cards and the upcard to bridge trump search ranges", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      belotCpuSearchCards(state.players[0].hand, state).map(
        (searchCard) => searchCard.id,
      ),
    ).toEqual(["VII-hearts", "IX-hearts"]);
  });

  it("uses EV-only voluntary CPU trump calls with a fixed base threshold", () => {
    const acceptingState = seededReadyState(5);
    const acceptingPlayerId = acceptingState.trumpTurnPlayerId!;
    const passingState = seededReadyState(1);
    const passingPlayerId = passingState.trumpTurnPlayerId!;

    expect(
      chooseBelotCpuAction(acceptingState, acceptingPlayerId, {
        rng: seededRng(1005),
        trumpMonteCarloSamples: 4,
        trumpSearchPlies: 4,
        trumpMinExpectedValue: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({
      type: "trump-accept-upcard",
      playerId: acceptingPlayerId,
    });

    expect(
      chooseBelotCpuAction(passingState, passingPlayerId, {
        rng: seededRng(1001),
        trumpMonteCarloSamples: 4,
        trumpSearchPlies: 4,
        trumpMinExpectedValue: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({
      type: "trump-pass",
      playerId: passingPlayerId,
    });
  });

  it("raises the voluntary trump EV threshold for thin visible trump suits", () => {
    expect(belotCpuTrumpCallExpectedValueThreshold(0)).toBe(50);
    expect(belotCpuTrumpCallExpectedValueThreshold(1)).toBe(40);
    expect(belotCpuTrumpCallExpectedValueThreshold(2)).toBe(30);
    expect(belotCpuTrumpCallExpectedValueThreshold(5)).toBe(30);
  });

  it("chooses a strong positive-value second-round trump suit when picking second", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trump-round-two",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("X", "acorns"),
            card("U", "acorns"),
            card("K", "acorns"),
            card("VII", "bells"),
            card("VIII", "bells"),
            card("X", "bells"),
            card("U", "bells"),
            card("A", "bells"),
          ],
          hiddenCards: [card("VII", "hearts"), card("VIII", "hearts")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [
            card("O", "acorns"),
            card("A", "acorns"),
            card("IX", "bells"),
            card("VII", "leaves"),
            card("VIII", "leaves"),
            card("O", "leaves"),
            card("K", "leaves"),
            card("A", "leaves"),
          ],
          hiddenCards: [card("VII", "acorns"), card("VIII", "acorns")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("U", "hearts"),
      trumpTurnPlayerId: "p2",
      firstPlayerId: "p1",
      trumpRound: 2,
      trumpPasses: ["p1"],
    };

    expect(chooseBelotCpuAction(state, "p2", { rng: seededRng(3) })).toEqual({
      type: "trump-choose-suit",
      playerId: "p2",
      suit: "leaves",
    });
  }, 10_000);

  it("passes the screenshot weak trump hand before pickup cards are known", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trump-round-two",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("O", "acorns"),
            card("X", "acorns"),
            card("VII", "bells"),
            card("K", "bells"),
            card("X", "bells"),
            card("VIII", "hearts"),
            card("O", "leaves"),
            card("K", "leaves"),
          ],
          hiddenCards: [card("IX", "hearts"), card("IX", "leaves")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [
            card("VIII", "acorns"),
            card("K", "acorns"),
            card("IX", "bells"),
            card("O", "hearts"),
            card("A", "hearts"),
            card("U", "hearts"),
            card("U", "leaves"),
            card("X", "leaves"),
          ],
          hiddenCards: [card("VII", "acorns"), card("A", "bells")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("U", "acorns"),
      trumpTurnPlayerId: "p2",
      firstPlayerId: "p1",
      trumpRound: 2,
      trumpPasses: ["p1"],
    };

    expect(chooseBelotCpuAction(state, "p2", { rng: seededRng(8) })).toEqual({
      type: "trump-pass",
      playerId: "p2",
    });
  }, 10_000);

  it("passes the mobile screenshot weak hearts hand before pickup cards are known", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trump-round-two",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("VIII", "acorns"),
            card("VII", "bells"),
            card("IX", "bells"),
            card("VII", "hearts"),
            card("K", "hearts"),
            card("X", "hearts"),
            card("IX", "leaves"),
            card("K", "leaves"),
          ],
          hiddenCards: [card("VII", "acorns"), card("X", "bells")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [
            card("IX", "acorns"),
            card("X", "acorns"),
            card("VIII", "bells"),
            card("K", "bells"),
            card("IX", "hearts"),
            card("U", "hearts"),
            card("VII", "leaves"),
            card("U", "leaves"),
          ],
          hiddenCards: [card("U", "acorns"), card("A", "leaves")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("A", "bells"),
      trumpTurnPlayerId: "p2",
      firstPlayerId: "p2",
      trumpRound: 2,
      trumpPasses: [],
    };

    expect(chooseBelotCpuAction(state, "p2", { rng: seededRng(1) })).toEqual({
      type: "trump-pass",
      playerId: "p2",
    });
  }, 10_000);

  it("does not treat a running score lead as trump-call success", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trump-round-one",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("IX", "acorns"),
            card("O", "bells"),
            card("X", "bells"),
            card("VII", "hearts"),
            card("K", "hearts"),
            card("A", "hearts"),
            card("VIII", "leaves"),
            card("IX", "leaves"),
          ],
          hiddenCards: [card("VIII", "hearts"), card("O", "hearts")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [
            card("O", "acorns"),
            card("X", "acorns"),
            card("VII", "bells"),
            card("VIII", "bells"),
            card("IX", "hearts"),
            card("U", "hearts"),
            card("VII", "leaves"),
            card("U", "leaves"),
          ],
          hiddenCards: [card("K", "acorns"), card("A", "acorns")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 160,
        },
      ],
      upcard: card("A", "leaves"),
      dealerPlayerId: "p2",
      firstPlayerId: "p1",
      trumpTurnPlayerId: "p2",
      trumpRound: 1,
      trumpPasses: ["p1"],
    };

    expect(chooseBelotCpuAction(state, "p2", { rng: seededRng(1) })).toEqual({
      type: "trump-pass",
      playerId: "p2",
    });
  }, 10_000);

  it("passes a one-visible-trump first-round bells hand below the raised EV threshold", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trump-round-one",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [
            card("K", "acorns"),
            card("X", "acorns"),
            card("A", "acorns"),
            card("O", "hearts"),
            card("K", "hearts"),
            card("X", "hearts"),
            card("A", "hearts"),
            card("IX", "leaves"),
          ],
          hiddenCards: [card("U", "acorns"), card("K", "leaves")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
        {
          ...players[1],
          ready: true,
          hand: [
            card("O", "acorns"),
            card("X", "acorns"),
            card("A", "acorns"),
            card("IX", "bells"),
            card("IX", "hearts"),
            card("K", "hearts"),
            card("U", "leaves"),
            card("X", "leaves"),
          ],
          hiddenCards: [card("VIII", "acorns"), card("VII", "leaves")],
          wonCards: [],
          tricksWon: 0,
          totalScore: 0,
        },
      ],
      upcard: card("U", "bells"),
      trumpTurnPlayerId: "p2",
      firstPlayerId: "p2",
      trumpRound: 1,
      trumpPasses: [],
    };

    expect(
      chooseBelotCpuAction(state, "p2", {
        rng: seededRng(2),
        trumpMonteCarloSamples: 64,
        trumpSearchPlies: 14,
      }),
    ).toEqual({
      type: "trump-pass",
      playerId: "p2",
    });
  }, 20_000);

  it("allows the CPU to pass the second trump round but still choose on mus", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
    const action = chooseBelotCpuAction(state, "p2", {
      trumpMinExpectedValue: Number.NEGATIVE_INFINITY,
    });

    expect(action).toEqual({
      type: "trump-pass",
      playerId: "p2",
    });
    expect(applyBelotAction(state, action!).phase).toBe("mus");
    expect(
      chooseBelotCpuAction(
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
          trumpMinExpectedValue: Number.POSITIVE_INFINITY,
        },
      )?.type,
    ).toBe("trump-choose-suit");
  });

  it("does not use hidden pickup card identities during CPU trump selection", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
    const changedHiddenState: BelotState = {
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

    expect(chooseBelotCpuAction(changedHiddenState, "p1", options)).toEqual(
      chooseBelotCpuAction(state, "p1", options),
    );
  });

  it("does not use hidden pickup cards or the actual opponent hand during CPU trump rollouts", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
    const changedHiddenState: BelotState = {
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

    expect(chooseBelotCpuAction(changedHiddenState, "p1", options)).toEqual(
      chooseBelotCpuAction(state, "p1", options),
    );
  });

  it("does not use hidden opponent cards or the unused deck for CPU trick decisions", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
    const changedHiddenState: BelotState = {
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

    expect(chooseBelotCpuAction(changedHiddenState, "p1", options)).toEqual(
      chooseBelotCpuAction(state, "p1", options),
    );
  });

  it("extends shallow CPU searches to finish the current trick before evaluation", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      chooseBelotCpuAction(state, "p1", {
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
    const voidState: BelotState = {
      ...createBelotInitialState(players),
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
      inferBelotCpuImpossibleOpponentCardIds(voidState, "p2"),
    );

    for (const rank of ["VII", "VIII", "IX", "X", "U", "O", "K", "A"]) {
      expect(voidImpossibleCards.has(`${rank}-acorns`)).toBe(true);
      expect(voidImpossibleCards.has(`${rank}-hearts`)).toBe(true);
    }

    const trumpedState: BelotState = {
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
      inferBelotCpuImpossibleOpponentCardIds(trumpedState, "p2"),
    );

    for (const rank of ["VII", "VIII", "IX", "X", "U", "O", "K", "A"]) {
      expect(trumpedImpossibleCards.has(`${rank}-acorns`)).toBe(true);
    }
    expect(trumpedImpossibleCards.has("U-hearts")).toBe(false);
    expect(trumpedImpossibleCards.has("A-hearts")).toBe(false);

    const trumpResponseState: BelotState = {
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
      inferBelotCpuImpossibleOpponentCardIds(trumpResponseState, "p2"),
    );

    expect(trumpResponseImpossibleCards.has("U-hearts")).toBe(false);
    expect(trumpResponseImpossibleCards.has("A-hearts")).toBe(false);
  });

  it("infers cheaper same-suit cards are unavailable after costly lost responses", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      inferBelotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("K-acorns")).toBe(true);
    expect(impossibleCards.has("U-acorns")).toBe(true);
    expect(impossibleCards.has("IX-acorns")).toBe(true);
    expect(impossibleCards.has("A-acorns")).toBe(false);
    expect(impossibleCards.has("K-bells")).toBe(false);
  });

  it("keeps cheaper same-suit cards possible when later play history disproves the costly response inference", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
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
      inferBelotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("K-acorns")).toBe(false);
    expect(impossibleCards.has("U-acorns")).toBe(false);
    expect(impossibleCards.has("IX-acorns")).toBe(false);
  });

  it("infers undeclared four-of-kind cards are unavailable from declarations and later plays", () => {
    const declaredCards = [
      card("IX", "hearts"),
      card("X", "hearts"),
      card("U", "hearts"),
    ];
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 2,
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
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("A", "acorns") },
            { playerId: "p2", card: card("IX", "acorns") },
          ],
        },
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("A", "bells") },
            { playerId: "p2", card: card("IX", "bells") },
          ],
        },
      ],
      declarationsByPlayer: {
        p1: [],
        p2: [
          {
            type: "SEQUENCE_3",
            cards: declaredCards,
            points: 20,
          },
        ],
      },
      publicCardsByPlayer: { p1: [], p2: declaredCards },
    };
    const impossibleCards = new Set(
      inferBelotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("IX-leaves")).toBe(true);
    expect(impossibleCards.has("VIII-leaves")).toBe(false);
  });

  it("infers cards that would extend a declared sequence are unavailable", () => {
    const declaredCards = [
      card("U", "acorns"),
      card("O", "acorns"),
      card("K", "acorns"),
    ];
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [],
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
      declarationsByPlayer: {
        p1: [],
        p2: [
          {
            type: "SEQUENCE_3",
            cards: declaredCards,
            points: 20,
          },
        ],
      },
      publicCardsByPlayer: { p1: [], p2: declaredCards },
    };
    const impossibleCards = new Set(
      inferBelotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("X-acorns")).toBe(true);
    expect(impossibleCards.has("A-acorns")).toBe(true);
    expect(impossibleCards.has("IX-acorns")).toBe(false);
  });

  it("uses later played cards to infer missing cards from undeclared longer sequences", () => {
    const declaredCards = [
      card("X", "bells"),
      card("U", "bells"),
      card("O", "bells"),
    ];
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [],
          hiddenCards: [],
          wonCards: [],
          tricksWon: 2,
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
      completedTricks: [
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("A", "acorns") },
            { playerId: "p2", card: card("VII", "bells") },
          ],
        },
        {
          winnerPlayerId: "p1",
          cards: [
            { playerId: "p1", card: card("A", "leaves") },
            { playerId: "p2", card: card("VIII", "bells") },
          ],
        },
      ],
      declarationsByPlayer: {
        p1: [],
        p2: [
          {
            type: "SEQUENCE_3",
            cards: declaredCards,
            points: 20,
          },
        ],
      },
      publicCardsByPlayer: { p1: [], p2: declaredCards },
    };
    const impossibleCards = new Set(
      inferBelotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("IX-bells")).toBe(true);
    expect(impossibleCards.has("A-bells")).toBe(false);
  });

  it("infers sequence edge cards are unavailable when no declarations were made", () => {
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [],
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
          tricksWon: 2,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      completedTricks: [
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p2", card: card("VIII", "bells") },
            { playerId: "p1", card: card("A", "bells") },
          ],
        },
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p2", card: card("IX", "bells") },
            { playerId: "p1", card: card("K", "bells") },
          ],
        },
      ],
      declarationsByPlayer: { p1: [], p2: [] },
      publicCardsByPlayer: { p1: [], p2: [] },
    };
    const impossibleCards = new Set(
      inferBelotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("VII-bells")).toBe(true);
    expect(impossibleCards.has("X-bells")).toBe(true);
  });

  it("keeps sequence edge cards possible when four-of-kind declaration explains the overlap", () => {
    const declaredCards = [
      card("IX", "acorns"),
      card("IX", "bells"),
      card("IX", "hearts"),
      card("IX", "leaves"),
    ];
    const state: BelotState = {
      ...createBelotInitialState(players),
      phase: "trick-play",
      players: [
        {
          ...players[0],
          ready: true,
          hand: [],
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
          tricksWon: 2,
          totalScore: 0,
        },
      ],
      trumpSuit: "hearts",
      callerPlayerId: "p1",
      currentTurnPlayerId: "p1",
      completedTricks: [
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p2", card: card("VIII", "bells") },
            { playerId: "p1", card: card("A", "bells") },
          ],
        },
        {
          winnerPlayerId: "p2",
          cards: [
            { playerId: "p2", card: card("IX", "bells") },
            { playerId: "p1", card: card("K", "bells") },
          ],
        },
      ],
      declarationsByPlayer: {
        p1: [],
        p2: [
          {
            type: "FOUR_NINES",
            cards: declaredCards,
            points: 150,
          },
        ],
      },
      publicCardsByPlayer: { p1: [], p2: declaredCards },
    };
    const impossibleCards = new Set(
      inferBelotCpuImpossibleOpponentCardIds(state, "p2"),
    );

    expect(impossibleCards.has("VII-bells")).toBe(false);
    expect(impossibleCards.has("X-bells")).toBe(false);
  });

  it("passes the caller when caller total is strictly greater", () => {
    const result = calculateBelotHandResult(
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
    const fellByDeclarations = calculateBelotHandResult(
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

    const fellOnGame = calculateBelotHandResult(
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

    const musSchuster = calculateBelotHandResult(
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

    const schusterWithDeclarations = calculateBelotHandResult(
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

    const declarationsDisabled = calculateBelotHandResult({
      ...scoringState({
        p1WonCards: [card("A", "acorns")],
        p2WonCards: [card("VII", "bells")],
        p1TricksWon: 9,
        p2TricksWon: 1,
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
        lastTrickWinnerPlayerId: "p1",
      }),
      rules: { declarationsEnabled: false },
    });

    expect(declarationsDisabled.declarationPointsByPlayer).toEqual({
      p1: 0,
      p2: 0,
    });
    expect(declarationsDisabled.totalPointsByPlayer).toEqual(
      declarationsDisabled.gamePointsByPlayer,
    );
    expect(declarationsDisabled.handScoreByPlayer.p1).toBe(21);
    expect(declarationsDisabled.handScoreByPlayer.p2).toBe(0);
  });

  it("finishes at 501 only when there is a winner after the hand", () => {
    const state: BelotState = {
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

    const finished = applyBelotAction(
      applyBelotAction(state, {
        type: "play-card",
        playerId: "p1",
        cardId: "A-acorns",
      }),
      { type: "play-card", playerId: "p2", cardId: "VII-bells" },
    );

    expect(finished.phase).toBe("finished");
    expect(finished.winnerPlayerId).toBe("p1");
  });

  it("continues with another hand when both players are tied after crossing 501", () => {
    const state: BelotState = {
      ...scoringState({
        p1WonCards: [card("X", "acorns")],
        p2WonCards: [card("A", "bells"), card("X", "bells")],
        p1TricksWon: 8,
        p2TricksWon: 1,
        lastTrickWinnerPlayerId: "p1",
      }),
      players: [
        {
          ...players[0],
          ready: true,
          hand: [card("A", "acorns")],
          hiddenCards: [],
          wonCards: [card("X", "acorns")],
          tricksWon: 8,
          totalScore: 490,
        },
        {
          ...players[1],
          ready: true,
          hand: [card("VII", "bells")],
          hiddenCards: [],
          wonCards: [card("A", "bells"), card("X", "bells")],
          tricksWon: 1,
          totalScore: 500,
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

    const tiedAfterHand = applyBelotAction(
      applyBelotAction(state, {
        type: "play-card",
        playerId: "p1",
        cardId: "A-acorns",
      }),
      { type: "play-card", playerId: "p2", cardId: "VII-bells" },
    );

    expect(tiedAfterHand.phase).toBe("hand-complete");
    expect(tiedAfterHand.winnerPlayerId).toBeUndefined();
    expect(tiedAfterHand.players.map((player) => player.totalScore)).toEqual([
      521, 521,
    ]);
  });
});
