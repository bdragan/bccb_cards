import type { Card, Rank, Suit } from "@card-games/shared";
import { suits } from "@card-games/shared";

import { createDeck, shuffleDeck } from "../../cards/deck";
import {
  applyBelotAction,
  autoSelectBelotDeclarations,
  belotCardPoints,
  compareBelotCards,
  legalBelotCards,
} from "./belot";
import type {
  BelotHandPlaySearchContext,
  BelotHandPlaySearchPolicy,
} from "./hand-play-search";
import {
  belotHandPlayAlphaBetaResult,
  belotHandPlayAlphaBetaValue,
  belotHandPlaySearchMaxUtility,
  createBelotHandPlaySearchContext,
} from "./hand-play-search";
import type {
  BelotAction,
  BelotPlayerState,
  BelotState,
  BelotTrickPlay,
} from "./types";

export type BelotCpuOptions = {
  maxSearchPlies?: number;
  monteCarloSamples?: number;
  rng?: () => number;
  trumpSearchPlies?: number;
  trumpMonteCarloSamples?: number;
  trumpMinSuccessRate?: number;
  trumpHighSuccessRate?: number;
  trumpMinCardsForStandardSuccess?: number;
  trumpMinExpectedValue?: number;
};

export const defaultBelotCpuMaxSearchPlies = 14;
const defaultMonteCarloSamples = 64;
const trumpMonteCarloSampleMultiplier = 1.5;
const defaultTrumpMinSuccessRate = 0.85;
const defaultTrumpHighSuccessRate = 0.9;
const defaultTrumpMinCardsForStandardSuccess = 3;
const defaultTrumpMinExpectedValue = 0;
const initialTrickHandCards = 10;
const cheapOpeningSearchPlies = 4;
const sampleIncreasePerMissingCard = 0.3;
const belotDeck = createDeck();
const trumpSearchRankGroups: Rank[][] = [
  ["VII", "VIII", "O", "K", "X", "A", "IX", "U"],
];
const nonTrumpSearchRankGroups: Rank[][] = [
  ["VII", "VIII", "IX", "U", "O", "K", "X", "A"],
];

type TrumpCandidateScore = {
  expectedValue: number;
  successRate: number;
};

type TrumpSuitCandidate = {
  suit: Suit;
  score: TrumpCandidateScore;
  trumpCardCount: number;
};

type TrumpRolloutSample = {
  cpuHiddenCards: Card[];
  opponentHand: Card[];
  unusedCards: Card[];
};

type TrumpCallThresholds = {
  minSuccessRate: number;
  highSuccessRate: number;
  minTrumpCards: number;
  minExpectedValue: number;
};

export type BelotCpuRootCardSampleStats = {
  sampleCount: number;
  successCount: number;
  totalWinningValue: number;
};

type BelotRootSampleSearchResult = {
  bestCardId: string;
  bestValue: number;
  searchedCardIds: string[];
  values: Array<{ cardId: string; value: number }>;
};

export function belotCpuMonteCarloSampleLimit(
  baseSampleCount: number,
  remainingHandCards: number,
) {
  const normalizedBaseSampleCount = Math.max(1, Math.floor(baseSampleCount));
  const missingCards = Math.max(0, initialTrickHandCards - remainingHandCards);

  return Math.max(
    1,
    Math.ceil(
      normalizedBaseSampleCount *
        (1 + missingCards * sampleIncreasePerMissingCard),
    ),
  );
}

export function belotCpuTrumpMonteCarloSamples(options: BelotCpuOptions = {}) {
  return (
    options.trumpMonteCarloSamples ??
    (options.monteCarloSamples ?? defaultMonteCarloSamples) *
      trumpMonteCarloSampleMultiplier
  );
}

export function chooseBelotCpuAction(
  state: BelotState,
  cpuPlayerId: string,
  options: BelotCpuOptions = {},
): BelotAction | undefined {
  const player = state.players.find(
    (candidate) => candidate.playerId === cpuPlayerId,
  );

  if (!player) {
    throw new Error("CPU player is not in this Belot game");
  }

  if (state.trumpTurnPlayerId === cpuPlayerId) {
    return chooseTrumpAction(state, player, options);
  }

  if (
    state.phase === "declarations" &&
    state.trumpSuit &&
    !Object.prototype.hasOwnProperty.call(
      state.declarationsByPlayer,
      cpuPlayerId,
    )
  ) {
    return {
      type: "declare",
      playerId: cpuPlayerId,
      declarations: autoSelectBelotDeclarations(player.hand, state.trumpSuit),
    };
  }

  if (
    state.phase === "trick-play" &&
    state.trumpSuit &&
    state.currentTurnPlayerId === cpuPlayerId
  ) {
    return {
      type: "play-card",
      playerId: cpuPlayerId,
      cardId: chooseCardForTrick(state, cpuPlayerId, options).id,
    };
  }

  return undefined;
}

export function inferBelotCpuImpossibleOpponentCardIds(
  state: BelotState,
  opponentPlayerId: string,
) {
  return [
    ...impossibleOpponentCardIdsFromPlayHistory(state, opponentPlayerId),
  ].sort((left, right) => left.localeCompare(right));
}

function chooseTrumpAction(
  state: BelotState,
  player: BelotPlayerState,
  options: BelotCpuOptions,
): BelotAction | undefined {
  const rng = options.rng ?? Math.random;
  const minExpectedValue =
    options.trumpMinExpectedValue ?? defaultTrumpMinExpectedValue;
  const highSuccessRate =
    options.trumpHighSuccessRate ?? defaultTrumpHighSuccessRate;
  const minTrumpCards =
    options.trumpMinCardsForStandardSuccess ??
    defaultTrumpMinCardsForStandardSuccess;
  const minSuccessRate =
    options.trumpMinSuccessRate ?? defaultTrumpMinSuccessRate;

  if (state.phase === "trump-round-one" && state.upcard) {
    const samples = createTrumpRolloutSamples(
      state,
      player.playerId,
      Math.max(1, belotCpuTrumpMonteCarloSamples(options)),
      rng,
    );
    const upcardCandidate = trumpSuitCandidate(
      state,
      player.playerId,
      state.upcard.suit,
      false,
      options,
      samples,
    );

    const trumpCardCount = countTrumpCards(player.hand, state.upcard.suit);
    const thresholds = {
      minSuccessRate,
      highSuccessRate,
      minTrumpCards,
      minExpectedValue,
    };
    const shouldAcceptUpcard = shouldCallTrump({
      score: upcardCandidate.score,
      trumpCardCount,
      thresholds,
    });

    if (!shouldAcceptUpcard) {
      return { type: "trump-pass", playerId: player.playerId };
    }

    const isFirstTrumpRoundTurn = state.trumpPasses.length === 0;
    const hasBetterOtherSuit =
      isFirstTrumpRoundTurn &&
      hasBetterRoundOneTrumpSuit(
        state,
        player.playerId,
        upcardCandidate,
        thresholds,
        options,
        samples,
      );

    return hasBetterOtherSuit
      ? { type: "trump-pass", playerId: player.playerId }
      : { type: "trump-accept-upcard", playerId: player.playerId };
  }

  if (
    (state.phase === "trump-round-two" || state.phase === "mus") &&
    state.upcard
  ) {
    const candidates = trumpSuitCandidates(
      state,
      player.playerId,
      suits.filter((suit) => suit !== state.upcard?.suit),
      state.phase === "mus",
      options,
      rng,
    );
    const thresholds = {
      minSuccessRate,
      highSuccessRate,
      minTrumpCards,
      minExpectedValue,
    };
    const bestCandidate = candidates[0];
    const acceptedCandidate =
      state.phase === "mus"
        ? bestCandidate
        : bestAcceptedTrumpCandidate(candidates, thresholds);

    if (acceptedCandidate) {
      return {
        type: "trump-choose-suit",
        playerId: player.playerId,
        suit: acceptedCandidate.suit,
      };
    }

    return { type: "trump-pass", playerId: player.playerId };
  }

  return undefined;
}

function hasBetterRoundOneTrumpSuit(
  state: BelotState,
  cpuPlayerId: string,
  upcardCandidate: TrumpSuitCandidate,
  thresholds: TrumpCallThresholds,
  options: BelotCpuOptions,
  samples: TrumpRolloutSample[],
) {
  if (!state.upcard) {
    return false;
  }

  return suits
    .filter((suit) => suit !== state.upcard?.suit)
    .some((suit) => {
      const candidate = trumpSuitCandidate(
        state,
        cpuPlayerId,
        suit,
        false,
        options,
        samples,
      );

      return (
        candidate.score.successRate > upcardCandidate.score.successRate &&
        shouldCallTrump({
          score: candidate.score,
          trumpCardCount: candidate.trumpCardCount,
          thresholds,
        })
      );
    });
}

function trumpSuitCandidates(
  state: BelotState,
  cpuPlayerId: string,
  candidateSuits: readonly Suit[],
  isMus: boolean,
  options: BelotCpuOptions,
  rng: () => number,
) {
  const samples = createTrumpRolloutSamples(
    state,
    cpuPlayerId,
    Math.max(1, belotCpuTrumpMonteCarloSamples(options)),
    rng,
  );
  const candidates = candidateSuits
    .map((suit) =>
      trumpSuitCandidate(state, cpuPlayerId, suit, isMus, options, samples),
    )
    .sort(compareTrumpCandidates);

  if (candidates.length === 0) {
    throw new Error("No selectable trump suit is available");
  }

  return candidates;
}

function trumpSuitCandidate(
  state: BelotState,
  cpuPlayerId: string,
  suit: Suit,
  isMus: boolean,
  options: BelotCpuOptions,
  samples: TrumpRolloutSample[],
): TrumpSuitCandidate {
  const cpu = playerById(state, cpuPlayerId);

  return {
    suit,
    score: scoreTrumpCandidate(
      state,
      cpuPlayerId,
      suit,
      isMus,
      options,
      samples,
    ),
    trumpCardCount: countTrumpCards(cpu.hand, suit),
  };
}

function scoreTrumpCandidate(
  state: BelotState,
  cpuPlayerId: string,
  trumpSuit: Suit,
  isMus: boolean,
  options: BelotCpuOptions,
  samples: TrumpRolloutSample[],
) {
  return averageTrumpRolloutScore(
    state,
    cpuPlayerId,
    trumpSuit,
    isMus,
    options,
    samples,
  );
}

function bestAcceptedTrumpCandidate(
  candidates: TrumpSuitCandidate[],
  thresholds: TrumpCallThresholds,
) {
  return candidates
    .filter((candidate) =>
      shouldCallTrump({
        score: candidate.score,
        trumpCardCount: candidate.trumpCardCount,
        thresholds,
      }),
    )
    .sort((left, right) =>
      compareAcceptedTrumpCandidates(left, right, thresholds),
    )[0];
}

function shouldCallTrump(input: {
  score: TrumpCandidateScore;
  trumpCardCount: number;
  thresholds: TrumpCallThresholds;
}) {
  return trumpAcceptanceTier(input) > 0;
}

function trumpAcceptanceTier(input: {
  score: TrumpCandidateScore;
  trumpCardCount: number;
  thresholds: TrumpCallThresholds;
}) {
  if (input.score.expectedValue < input.thresholds.minExpectedValue) {
    return 0;
  }

  const highSuccessRate = Math.max(
    input.thresholds.highSuccessRate,
    input.thresholds.minSuccessRate,
  );

  if (input.score.successRate >= highSuccessRate) {
    return 2;
  }

  if (
    input.score.successRate >= input.thresholds.minSuccessRate &&
    input.trumpCardCount >= input.thresholds.minTrumpCards
  ) {
    return 1;
  }

  return 0;
}

function countTrumpCards(hand: Card[], trumpSuit: Suit) {
  return hand.filter((card) => card.suit === trumpSuit).length;
}

function compareAcceptedTrumpCandidates(
  left: TrumpSuitCandidate,
  right: TrumpSuitCandidate,
  thresholds: TrumpCallThresholds,
) {
  const tierDelta =
    trumpAcceptanceTier({
      score: right.score,
      trumpCardCount: right.trumpCardCount,
      thresholds,
    }) -
    trumpAcceptanceTier({
      score: left.score,
      trumpCardCount: left.trumpCardCount,
      thresholds,
    });

  if (tierDelta !== 0) {
    return tierDelta;
  }

  return compareTrumpCandidates(left, right);
}

function compareTrumpCandidates(
  left: TrumpSuitCandidate,
  right: TrumpSuitCandidate,
) {
  const successRateDelta = right.score.successRate - left.score.successRate;

  if (successRateDelta !== 0) {
    return successRateDelta;
  }

  const expectedValueDelta =
    right.score.expectedValue - left.score.expectedValue;

  if (expectedValueDelta !== 0) {
    return expectedValueDelta;
  }

  return right.trumpCardCount - left.trumpCardCount;
}

function averageTrumpRolloutScore(
  state: BelotState,
  cpuPlayerId: string,
  trumpSuit: Suit,
  isMus: boolean,
  options: BelotCpuOptions,
  samples: TrumpRolloutSample[],
): TrumpCandidateScore {
  const rolloutStates = samples.map((sample) =>
    createTrumpRolloutState(state, cpuPlayerId, trumpSuit, isMus, sample),
  );
  const searchPlies =
    options.trumpSearchPlies ??
    options.maxSearchPlies ??
    defaultBelotCpuMaxSearchPlies;
  const results = rolloutStates.map((sample) => {
    const searchContext = createBelotHandPlaySearchContext(
      searchPlies,
      belotCpuHandPlaySearchPolicy,
    );

    return belotHandPlayAlphaBetaResult(
      sample,
      cpuPlayerId,
      searchPlies,
      -belotHandPlaySearchMaxUtility,
      belotHandPlaySearchMaxUtility,
      searchContext,
    );
  });
  const successes = results.filter((result, index) =>
    trumpCandidateSucceedsFromRawGamePointDelta(
      rolloutStates[index],
      cpuPlayerId,
      result.value,
    ),
  ).length;

  return {
    expectedValue:
      results.reduce((sum, result) => sum + result.value, 0) / results.length,
    successRate: successes / results.length,
  };
}

function createTrumpRolloutSamples(
  state: BelotState,
  cpuPlayerId: string,
  sampleCount: number,
  rng: () => number,
) {
  const cpu = playerById(state, cpuPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== cpuPlayerId,
  );

  if (!opponent) {
    throw new Error("CPU opponent is not available");
  }

  const knownCardIds = new Set(cpu.hand.map((card) => card.id));

  if (state.upcard) {
    knownCardIds.add(state.upcard.id);
  }

  const unknownPool = createDeck().filter((card) => !knownCardIds.has(card.id));
  const cpuHiddenCount = cpu.hiddenCards.length;
  const opponentCardCount = opponent.hand.length + opponent.hiddenCards.length;
  const samples = sampleUniqueTrumpRollouts(
    unknownPool,
    cpuHiddenCount,
    opponentCardCount,
    sampleCount,
    rng,
  );

  return samples.map((sample) => {
    const sampledCardIds = new Set(
      [...sample.cpuHiddenCards, ...sample.opponentHand].map((card) => card.id),
    );

    return {
      cpuHiddenCards: sample.cpuHiddenCards,
      opponentHand: sample.opponentHand,
      unusedCards: unknownPool.filter((card) => !sampledCardIds.has(card.id)),
    };
  });
}

function createTrumpRolloutState(
  state: BelotState,
  cpuPlayerId: string,
  trumpSuit: Suit,
  isMus: boolean,
  sample: TrumpRolloutSample,
) {
  const cpu = playerById(state, cpuPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== cpuPlayerId,
  );

  if (!opponent) {
    throw new Error("CPU opponent is not available");
  }

  const sampledCpuHand = [...cpu.hand, ...sample.cpuHiddenCards];
  const declarationsByPlayer = {
    [cpuPlayerId]: autoSelectBelotDeclarations(sampledCpuHand, trumpSuit),
    [opponent.playerId]: autoSelectBelotDeclarations(
      sample.opponentHand,
      trumpSuit,
    ),
  };

  return {
    ...state,
    phase: "trick-play" as const,
    unusedCards: sample.unusedCards,
    players: state.players.map((player) =>
      player.playerId === cpuPlayerId
        ? { ...player, hand: sampledCpuHand, hiddenCards: [] }
        : { ...player, hand: sample.opponentHand, hiddenCards: [] },
    ),
    trumpSuit,
    callerPlayerId: cpuPlayerId,
    isMus,
    trumpTurnPlayerId: undefined,
    currentTurnPlayerId: state.firstPlayerId,
    currentTrick: [],
    completedTricks: [],
    declarationsByPlayer,
    publicCardsByPlayer: Object.fromEntries(
      state.players.map((player) => [player.playerId, []]),
    ),
    lastHandResult: undefined,
    error: undefined,
  };
}

function chooseCardForTrick(
  state: BelotState,
  cpuPlayerId: string,
  options: BelotCpuOptions,
) {
  if (!state.trumpSuit) {
    throw new Error("Cannot choose a card before trump is selected");
  }

  const cpu = playerById(state, cpuPlayerId);
  const legalCards = legalBelotCards(
    cpu.hand,
    state.currentTrick,
    state.trumpSuit,
  );

  if (legalCards.length === 0) {
    throw new Error("CPU has no legal card to play");
  }

  if (legalCards.length === 1) {
    return legalCards[0];
  }

  const rng = options.rng ?? Math.random;
  const maxSearchPlies =
    options.maxSearchPlies ?? defaultBelotCpuMaxSearchPlies;
  const samples = createDeterminizedStates(
    state,
    cpuPlayerId,
    belotCpuMonteCarloSampleLimit(
      options.monteCarloSamples ?? defaultMonteCarloSamples,
      cpu.hand.length,
    ),
    rng,
  );
  const searchCards = belotCpuSearchCards(legalCards, {
    ...state,
    unusedCards: [],
  });
  const rootCardStats = createRootCardSampleStats(searchCards);
  const scores = new Map(searchCards.map((card) => [card.id, 0]));

  for (const sample of samples) {
    const sampleSearchCards = belotCpuSearchCards(searchCards, sample);
    const searchContext = createBelotHandPlaySearchContext(
      maxSearchPlies,
      belotCpuHandPlaySearchPolicy,
    );
    const sampleResult = searchRootCardsForSample(
      sample,
      cpuPlayerId,
      sampleSearchCards,
      rootCardStats,
      maxSearchPlies,
      searchContext,
    );

    for (const result of sampleResult.values) {
      scores.set(result.cardId, (scores.get(result.cardId) ?? 0) + result.value);
    }

    updateRootCardSampleStats(rootCardStats, sampleResult);
  }

  return searchCards.slice().sort((left, right) => {
    const scoreDelta = (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const heuristicDelta =
      cardSearchOrderingScore(right, state, true) -
      cardSearchOrderingScore(left, state, true);

    if (heuristicDelta !== 0) {
      return heuristicDelta;
    }

    return left.id.localeCompare(right.id);
  })[0];
}

function searchRootCardsForSample(
  sample: BelotState,
  cpuPlayerId: string,
  rootCards: Card[],
  rootCardStats: ReadonlyMap<string, BelotCpuRootCardSampleStats>,
  maxSearchPlies: number,
  searchContext: BelotHandPlaySearchContext,
): BelotRootSampleSearchResult {
  let bestCardId = rootCards[0]?.id;
  let bestValue = -belotHandPlaySearchMaxUtility;
  const searchedCardIds: string[] = [];
  const values: Array<{ cardId: string; value: number }> = [];

  if (!bestCardId) {
    throw new Error("CPU has no root cards to search");
  }

  for (const card of belotCpuOrderRootCardsForSearch(
    rootCards,
    sample,
    rootCardStats,
  )) {
    const next = applyBelotAction(sample, {
      type: "play-card",
      playerId: cpuPlayerId,
      cardId: card.id,
    });
    const value = belotHandPlayAlphaBetaValue(
      next,
      cpuPlayerId,
      maxSearchPlies - 1,
      -belotHandPlaySearchMaxUtility,
      belotHandPlaySearchMaxUtility,
      searchContext,
    );

    searchedCardIds.push(card.id);
    values.push({ cardId: card.id, value });

    if (value > bestValue) {
      bestCardId = card.id;
      bestValue = value;
    }
  }

  return { bestCardId, bestValue, searchedCardIds, values };
}

export function belotCpuSearchCards(cards: Card[], state: BelotState) {
  if (!state.trumpSuit) {
    return cards;
  }

  const responseCards = cheapestLosingResponseCardsBySuit(cards, state);

  if (responseCards.length <= 1) {
    return responseCards;
  }

  const keepCardIds = new Set<string>();
  const candidateCardIds = new Set(responseCards.map((card) => card.id));
  const connectedCardIds = new Set([
    ...candidateCardIds,
    ...knownPlayedOrDeadCards(state).map((card) => card.id),
  ]);

  for (const suit of suits) {
    const rankGroups =
      suit === state.trumpSuit
        ? trumpSearchRankGroups
        : nonTrumpSearchRankGroups;

    for (const rankGroup of rankGroups) {
      let run: Card[] = [];

      for (const rank of rankGroup) {
        const card = belotDeck.find(
          (candidate) => candidate.suit === suit && candidate.rank === rank,
        );

        if (card && connectedCardIds.has(card.id)) {
          run.push(card);
          continue;
        }

        addSearchCardRangeEndpoints(keepCardIds, run, candidateCardIds, state);
        run = [];
      }

      addSearchCardRangeEndpoints(keepCardIds, run, candidateCardIds, state);
    }
  }

  return responseCards.filter((card) => keepCardIds.has(card.id));
}

function cheapestLosingResponseCardsBySuit(cards: Card[], state: BelotState) {
  if (!state.trumpSuit || state.currentTrick.length === 0) {
    return cards;
  }

  const keepCardIds = new Set<string>();
  const cheapestLosingCardsBySuit = new Map<Suit, Card>();
  const preferredNonTrumpWinningResponseCard = nonTrumpWinningResponseAceOrTen(
    cards,
    state,
  );

  for (const card of cards) {
    if (wouldCurrentlyWin(card, state.currentTrick, state.trumpSuit)) {
      if (
        preferredNonTrumpWinningResponseCard &&
        card.suit === preferredNonTrumpWinningResponseCard.suit &&
        card.id !== preferredNonTrumpWinningResponseCard.id
      ) {
        continue;
      }

      keepCardIds.add(card.id);
      continue;
    }

    const cheapest = cheapestLosingCardsBySuit.get(card.suit);

    if (
      !cheapest ||
      compareCardsByCheapValue(card, cheapest, state.trumpSuit) < 0
    ) {
      cheapestLosingCardsBySuit.set(card.suit, card);
    }
  }

  for (const card of cheapestLosingCardsBySuit.values()) {
    keepCardIds.add(card.id);
  }

  return cards.filter((card) => keepCardIds.has(card.id));
}

function nonTrumpWinningResponseAceOrTen(cards: Card[], state: BelotState) {
  if (!state.trumpSuit || state.currentTrick.length === 0) {
    return undefined;
  }

  const leadSuit = state.currentTrick[0]?.card.suit;

  if (!leadSuit || leadSuit === state.trumpSuit) {
    return undefined;
  }

  const ace = cards.find((card) => card.suit === leadSuit && card.rank === "A");
  const ten = cards.find((card) => card.suit === leadSuit && card.rank === "X");

  if (
    ace &&
    (ten || hasPlayedCard(state, leadSuit, "X")) &&
    wouldCurrentlyWin(ace, state.currentTrick, state.trumpSuit)
  ) {
    return ace;
  }

  if (
    ten &&
    !ace &&
    wouldCurrentlyWin(ten, state.currentTrick, state.trumpSuit)
  ) {
    return ten;
  }

  return undefined;
}

function hasPlayedCard(state: BelotState, suit: Suit, rank: Rank) {
  for (const play of state.currentTrick) {
    if (play.card.suit === suit && play.card.rank === rank) {
      return true;
    }
  }

  for (const trick of state.completedTricks) {
    for (const play of trick.cards) {
      if (play.card.suit === suit && play.card.rank === rank) {
        return true;
      }
    }
  }

  for (const player of state.players) {
    for (const card of player.wonCards) {
      if (card.suit === suit && card.rank === rank) {
        return true;
      }
    }
  }

  return false;
}

export function belotCpuCheapSearchCard(
  cards: Card[],
  state: BelotState,
): Card {
  if (cards.length === 0) {
    throw new Error("No cards are available for cheap Belot search");
  }

  if (!state.trumpSuit) {
    return cards[0];
  }

  if (state.currentTrick.length > 0) {
    const winningCards = cards.filter((card) =>
      wouldCurrentlyWin(card, state.currentTrick, state.trumpSuit!),
    );
    const preferredNonTrumpWinningResponseCard =
      nonTrumpWinningResponseAceOrTen(cards, state);
    const candidates = preferredNonTrumpWinningResponseCard
      ? [preferredNonTrumpWinningResponseCard]
      : winningCards.length
        ? winningCards
        : cards;

    return candidates
      .slice()
      .sort((left, right) =>
        compareCardsByCheapValue(left, right, state.trumpSuit!),
      )[0];
  }

  const nonTrumpCards = cards.filter((card) => card.suit !== state.trumpSuit);
  const currentPlayer = state.currentTurnPlayerId
    ? playerById(state, state.currentTurnPlayerId)
    : undefined;
  const opponent = state.currentTurnPlayerId
    ? state.players.find(
        (player) => player.playerId !== state.currentTurnPlayerId,
      )
    : undefined;

  if (currentPlayer && opponent) {
    const opponentSuits = new Set(opponent.hand.map((card) => card.suit));
    const sharedSuitNonTrumpCards = nonTrumpCards.filter((card) =>
      opponentSuits.has(card.suit),
    );

    if (sharedSuitNonTrumpCards.length) {
      return highestCheapValueCard(sharedSuitNonTrumpCards, state.trumpSuit);
    }

    const currentPlayerTrumpCount = countTrumpCards(
      currentPlayer.hand,
      state.trumpSuit,
    );
    const opponentTrumpCount = countTrumpCards(opponent.hand, state.trumpSuit);

    if (opponentTrumpCount < currentPlayerTrumpCount) {
      const trumpCards = cards.filter((card) => card.suit === state.trumpSuit);

      if (trumpCards.length) {
        return highestCheapValueCard(trumpCards, state.trumpSuit);
      }
    }
  }

  const candidates = nonTrumpCards.length ? nonTrumpCards : cards;

  return highestCheapValueCard(candidates, state.trumpSuit);
}

function addSearchCardRangeEndpoints(
  keepCardIds: Set<string>,
  run: Card[],
  candidateCardIds: Set<string>,
  state: BelotState,
) {
  const playableCards = run.filter((card) => candidateCardIds.has(card.id));
  const first = playableCards[0];
  const last = playableCards[playableCards.length - 1];

  if (!first) {
    return;
  }

  if (!last || first.id === last.id) {
    keepCardIds.add(first.id);
    return;
  }

  if (state.trumpSuit && state.currentTrick.length > 0) {
    const firstWins = wouldCurrentlyWin(
      first,
      state.currentTrick,
      state.trumpSuit,
    );
    const lastWins = wouldCurrentlyWin(
      last,
      state.currentTrick,
      state.trumpSuit,
    );

    if (firstWins === lastWins) {
      keepCardIds.add(firstWins ? last.id : first.id);
      return;
    }
  }

  keepCardIds.add(first.id);
  keepCardIds.add(last.id);
}

function knownPlayedOrDeadCards(state: BelotState) {
  const cards: Card[] = [];

  cards.push(...(state.unusedCards ?? []));

  if (state.upcard) {
    cards.push(state.upcard);
  }

  for (const play of state.currentTrick) {
    cards.push(play.card);
  }

  for (const trick of state.completedTricks) {
    for (const play of trick.cards) {
      cards.push(play.card);
    }
  }

  for (const player of state.players) {
    cards.push(...player.wonCards);
  }

  return cards;
}

function createDeterminizedStates(
  state: BelotState,
  cpuPlayerId: string,
  sampleCount: number,
  rng: () => number,
) {
  const opponent = state.players.find(
    (player) => player.playerId !== cpuPlayerId,
  );

  if (!opponent) {
    throw new Error("CPU opponent is not available");
  }

  const opponentKnownCards = knownUnplayedOpponentCards(
    state,
    opponent.playerId,
  );
  const unknownNeeded = Math.max(
    0,
    opponent.hand.length - opponentKnownCards.length,
  );
  const impossibleOpponentCardIds = impossibleOpponentCardIdsFromPlayHistory(
    state,
    opponent.playerId,
  );
  const unknownCards = unknownCardsForCpu(
    state,
    cpuPlayerId,
    opponentKnownCards,
  );
  const unknownPool = unknownCards.filter(
    (card) => !impossibleOpponentCardIds.has(card.id),
  );
  const samples =
    unknownNeeded > 0
      ? sampleUniqueCardCombinations(
          unknownPool,
          unknownNeeded,
          sampleCount,
          rng,
        )
      : [[]];

  return samples.map((sampledUnknownCards) => {
    const sampledOpponentHand = [...opponentKnownCards, ...sampledUnknownCards];
    const sampledCardIds = new Set(sampledUnknownCards.map((card) => card.id));
    const sampledUnusedCards = unknownCards.filter(
      (card) => !sampledCardIds.has(card.id),
    );

    return {
      ...state,
      unusedCards: sampledUnusedCards,
      players: state.players.map((player) =>
        player.playerId === opponent.playerId
          ? { ...player, hand: sampledOpponentHand }
          : { ...player, hand: [...player.hand] },
      ),
      currentTrick: state.currentTrick.map((play) => ({ ...play })),
      completedTricks: state.completedTricks.map((trick) => ({
        ...trick,
        cards: trick.cards.map((play) => ({ ...play })),
      })),
    };
  });
}

function sampleUniqueTrumpRollouts(
  unknownPool: Card[],
  requestedCpuHiddenCount: number,
  requestedOpponentCardCount: number,
  sampleCount: number,
  rng: () => number,
) {
  const cpuHiddenCount = Math.min(requestedCpuHiddenCount, unknownPool.length);
  const opponentCardCount = Math.min(
    requestedOpponentCardCount,
    unknownPool.length - cpuHiddenCount,
  );
  const requestedSampleCount = Math.max(1, Math.floor(sampleCount));
  const possibleSampleCount = cappedTrumpRolloutCount(
    unknownPool.length,
    cpuHiddenCount,
    opponentCardCount,
    requestedSampleCount + 1,
  );
  const targetSampleCount = Math.min(requestedSampleCount, possibleSampleCount);

  if (possibleSampleCount <= requestedSampleCount) {
    return enumerateTrumpRollouts(
      unknownPool,
      cpuHiddenCount,
      opponentCardCount,
      targetSampleCount,
    );
  }

  const samples: Array<{ cpuHiddenCards: Card[]; opponentHand: Card[] }> = [];
  const seenSampleKeys = new Set<string>();
  const maxRandomAttempts = targetSampleCount * 10;

  for (
    let attempts = 0;
    samples.length < targetSampleCount && attempts < maxRandomAttempts;
    attempts += 1
  ) {
    const sampledCards = shuffleDeck(unknownPool, rng);
    const cpuHiddenCards = sampledCards.slice(0, cpuHiddenCount);
    const opponentHand = sampledCards.slice(
      cpuHiddenCount,
      cpuHiddenCount + opponentCardCount,
    );
    const key = sampleKey(cpuHiddenCards, opponentHand);

    if (seenSampleKeys.has(key)) {
      continue;
    }

    seenSampleKeys.add(key);
    samples.push({ cpuHiddenCards, opponentHand });
  }

  if (samples.length < targetSampleCount) {
    for (const sample of iterateTrumpRollouts(
      unknownPool,
      cpuHiddenCount,
      opponentCardCount,
    )) {
      const key = sampleKey(sample.cpuHiddenCards, sample.opponentHand);

      if (seenSampleKeys.has(key)) {
        continue;
      }

      seenSampleKeys.add(key);
      samples.push(sample);

      if (samples.length >= targetSampleCount) {
        break;
      }
    }
  }

  return samples;
}

function sampleUniqueCardCombinations(
  unknownPool: Card[],
  requestedCardCount: number,
  sampleCount: number,
  rng: () => number,
) {
  const cardCount = Math.min(requestedCardCount, unknownPool.length);
  const requestedSampleCount = Math.max(1, Math.floor(sampleCount));
  const possibleSampleCount = cappedCombinationCount(
    unknownPool.length,
    cardCount,
    requestedSampleCount + 1,
  );
  const targetSampleCount = Math.min(requestedSampleCount, possibleSampleCount);

  if (possibleSampleCount <= requestedSampleCount) {
    return enumerateCardCombinations(unknownPool, cardCount, targetSampleCount);
  }

  const samples: Card[][] = [];
  const seenSampleKeys = new Set<string>();
  const maxRandomAttempts = targetSampleCount * 10;

  for (
    let attempts = 0;
    samples.length < targetSampleCount && attempts < maxRandomAttempts;
    attempts += 1
  ) {
    const sample = shuffleDeck(unknownPool, rng).slice(0, cardCount);
    const key = cardSetKey(sample);

    if (seenSampleKeys.has(key)) {
      continue;
    }

    seenSampleKeys.add(key);
    samples.push(sample);
  }

  if (samples.length < targetSampleCount) {
    for (const sample of iterateCardCombinations(unknownPool, cardCount)) {
      const key = cardSetKey(sample);

      if (seenSampleKeys.has(key)) {
        continue;
      }

      seenSampleKeys.add(key);
      samples.push(sample);

      if (samples.length >= targetSampleCount) {
        break;
      }
    }
  }

  return samples;
}

function enumerateTrumpRollouts(
  unknownPool: Card[],
  cpuHiddenCount: number,
  opponentCardCount: number,
  sampleCount: number,
) {
  const samples: Array<{ cpuHiddenCards: Card[]; opponentHand: Card[] }> = [];

  for (const sample of iterateTrumpRollouts(
    unknownPool,
    cpuHiddenCount,
    opponentCardCount,
  )) {
    samples.push(sample);

    if (samples.length >= sampleCount) {
      break;
    }
  }

  return samples;
}

function* iterateTrumpRollouts(
  unknownPool: Card[],
  cpuHiddenCount: number,
  opponentCardCount: number,
): Generator<{ cpuHiddenCards: Card[]; opponentHand: Card[] }> {
  for (const cpuHiddenCards of iterateCardCombinations(
    unknownPool,
    cpuHiddenCount,
  )) {
    const cpuHiddenCardIds = new Set(cpuHiddenCards.map((card) => card.id));
    const remainingCards = unknownPool.filter(
      (card) => !cpuHiddenCardIds.has(card.id),
    );

    for (const opponentHand of iterateCardCombinations(
      remainingCards,
      opponentCardCount,
    )) {
      yield { cpuHiddenCards, opponentHand };
    }
  }
}

function enumerateCardCombinations(
  cards: Card[],
  cardCount: number,
  sampleCount: number,
) {
  const samples: Card[][] = [];

  for (const sample of iterateCardCombinations(cards, cardCount)) {
    samples.push(sample);

    if (samples.length >= sampleCount) {
      break;
    }
  }

  return samples;
}

function* iterateCardCombinations(
  cards: Card[],
  cardCount: number,
): Generator<Card[]> {
  if (cardCount < 0 || cardCount > cards.length) {
    return;
  }

  if (cardCount === 0) {
    yield [];
    return;
  }

  const indices = Array.from({ length: cardCount }, (_, index) => index);

  while (true) {
    yield indices.map((index) => cards[index]);

    let pivotIndex = cardCount - 1;

    while (
      pivotIndex >= 0 &&
      indices[pivotIndex] === cards.length - cardCount + pivotIndex
    ) {
      pivotIndex -= 1;
    }

    if (pivotIndex < 0) {
      return;
    }

    indices[pivotIndex] += 1;

    for (let index = pivotIndex + 1; index < cardCount; index += 1) {
      indices[index] = indices[index - 1] + 1;
    }
  }
}

function cappedTrumpRolloutCount(
  cardCount: number,
  cpuHiddenCount: number,
  opponentCardCount: number,
  cap: number,
) {
  const hiddenCardCombinations = cappedCombinationCount(
    cardCount,
    cpuHiddenCount,
    cap,
  );
  const opponentHandCombinations = cappedCombinationCount(
    cardCount - cpuHiddenCount,
    opponentCardCount,
    cap,
  );

  return cappedProduct(hiddenCardCombinations, opponentHandCombinations, cap);
}

function cappedCombinationCount(
  cardCount: number,
  chooseCount: number,
  cap: number,
) {
  if (chooseCount < 0 || chooseCount > cardCount) {
    return 0;
  }

  const smallerChooseCount = Math.min(chooseCount, cardCount - chooseCount);
  let result = 1;

  for (let index = 1; index <= smallerChooseCount; index += 1) {
    result = (result * (cardCount - smallerChooseCount + index)) / index;

    if (result >= cap) {
      return cap;
    }
  }

  return Math.round(result);
}

function cappedProduct(left: number, right: number, cap: number) {
  if (left === 0 || right === 0) {
    return 0;
  }

  if (left >= cap / right) {
    return cap;
  }

  return left * right;
}

function sampleKey(cpuHiddenCards: Card[], opponentHand: Card[]) {
  return `${cardSetKey(cpuHiddenCards)}|${cardSetKey(opponentHand)}`;
}

function cardSetKey(cards: Card[]) {
  return cards
    .map((card) => card.id)
    .sort((left, right) => left.localeCompare(right))
    .join(",");
}

function impossibleOpponentCardIdsFromPlayHistory(
  state: BelotState,
  opponentPlayerId: string,
) {
  const impossibleCardIds = new Set<string>();

  if (!state.trumpSuit) {
    return impossibleCardIds;
  }

  for (const trick of state.completedTricks) {
    addImpossibleCardsFromResponse(
      impossibleCardIds,
      trick.cards,
      opponentPlayerId,
      state.trumpSuit,
    );
  }

  addImpossibleCardsFromResponse(
    impossibleCardIds,
    state.currentTrick,
    opponentPlayerId,
    state.trumpSuit,
  );
  addImpossibleCheapCardsFromCostlyLostResponses(
    impossibleCardIds,
    state,
    opponentPlayerId,
    state.trumpSuit,
  );

  return impossibleCardIds;
}

function addImpossibleCardsFromResponse(
  impossibleCardIds: Set<string>,
  plays: BelotTrickPlay[],
  opponentPlayerId: string,
  trumpSuit: Suit,
) {
  const responseIndex = plays.findIndex(
    (play) => play.playerId === opponentPlayerId,
  );

  if (responseIndex <= 0) {
    return;
  }

  const lead = plays[0];
  const response = plays[responseIndex];
  if (!lead || !response) {
    return;
  }

  if (response.card.suit !== lead.card.suit) {
    addSuitToImpossibleCards(impossibleCardIds, lead.card.suit);

    if (response.card.suit !== trumpSuit) {
      addSuitToImpossibleCards(impossibleCardIds, trumpSuit);
    }

    return;
  }
}

function addSuitToImpossibleCards(impossibleCardIds: Set<string>, suit: Suit) {
  for (const card of createDeck()) {
    if (card.suit === suit) {
      impossibleCardIds.add(card.id);
    }
  }
}

function addImpossibleCheapCardsFromCostlyLostResponses(
  impossibleCardIds: Set<string>,
  state: BelotState,
  opponentPlayerId: string,
  trumpSuit: Suit,
) {
  const trickHistory = [
    ...state.completedTricks.map((trick) => ({
      cards: trick.cards,
      winnerPlayerId: trick.winnerPlayerId,
    })),
    ...(state.currentTrick.length > 1
      ? [
          {
            cards: state.currentTrick,
            winnerPlayerId: trickWinner(state.currentTrick, trumpSuit).playerId,
          },
        ]
      : []),
  ];

  for (let trickIndex = 0; trickIndex < trickHistory.length; trickIndex += 1) {
    const trick = trickHistory[trickIndex];
    const responseIndex = trick.cards.findIndex(
      (play) => play.playerId === opponentPlayerId,
    );

    if (responseIndex <= 0 || trick.winnerPlayerId === opponentPlayerId) {
      continue;
    }

    const response = trick.cards[responseIndex];

    if (!response) {
      continue;
    }

    const responsePoints = belotCardPoints(response.card, trumpSuit);

    if (
      responsePoints < 10 ||
      hasSubsequentCheaperOpponentCard(
        trickHistory,
        trickIndex,
        opponentPlayerId,
        response.card.suit,
        responsePoints,
        trumpSuit,
      )
    ) {
      continue;
    }

    for (const card of belotDeck) {
      if (
        card.suit === response.card.suit &&
        belotCardPoints(card, trumpSuit) < responsePoints
      ) {
        impossibleCardIds.add(card.id);
      }
    }
  }
}

function hasSubsequentCheaperOpponentCard(
  trickHistory: Array<{
    cards: BelotTrickPlay[];
    winnerPlayerId: string;
  }>,
  trickIndex: number,
  opponentPlayerId: string,
  suit: Suit,
  responsePoints: number,
  trumpSuit: Suit,
) {
  for (let index = trickIndex + 1; index < trickHistory.length; index += 1) {
    const subsequentPlay = trickHistory[index].cards.find(
      (play) => play.playerId === opponentPlayerId,
    );

    if (
      subsequentPlay?.card.suit === suit &&
      belotCardPoints(subsequentPlay.card, trumpSuit) < responsePoints
    ) {
      return true;
    }
  }

  return false;
}

function unknownCardsForCpu(
  state: BelotState,
  cpuPlayerId: string,
  opponentKnownCards: Card[],
) {
  const knownCardIds = new Set<string>();
  const cpu = playerById(state, cpuPlayerId);

  for (const card of cpu.hand) {
    knownCardIds.add(card.id);
  }

  for (const card of cpu.wonCards) {
    knownCardIds.add(card.id);
  }

  if (state.upcard) {
    knownCardIds.add(state.upcard.id);
  }

  for (const play of state.currentTrick) {
    knownCardIds.add(play.card.id);
  }

  for (const trick of state.completedTricks) {
    for (const play of trick.cards) {
      knownCardIds.add(play.card.id);
    }
  }

  for (const cards of Object.values(state.publicCardsByPlayer)) {
    for (const card of cards) {
      knownCardIds.add(card.id);
    }
  }

  for (const card of opponentKnownCards) {
    knownCardIds.add(card.id);
  }

  return createDeck().filter((card) => !knownCardIds.has(card.id));
}

function knownUnplayedOpponentCards(
  state: BelotState,
  opponentPlayerId: string,
) {
  const playedCardIds = new Set<string>();

  for (const play of state.currentTrick) {
    playedCardIds.add(play.card.id);
  }

  for (const trick of state.completedTricks) {
    for (const play of trick.cards) {
      playedCardIds.add(play.card.id);
    }
  }

  return (state.publicCardsByPlayer[opponentPlayerId] ?? []).filter(
    (card) => !playedCardIds.has(card.id),
  );
}

function trumpCandidateSucceedsFromRawGamePointDelta(
  state: BelotState,
  cpuPlayerId: string,
  rawGamePointDelta: number,
) {
  if (!state.trumpSuit || state.callerPlayerId !== cpuPlayerId) {
    throw new Error("Trump candidate success requires CPU to be caller");
  }

  const opponent = state.players.find(
    (player) => player.playerId !== cpuPlayerId,
  );

  if (!opponent) {
    throw new Error("CPU opponent is not available");
  }

  const totalGamePoints = totalPlayableGamePoints(state);
  const cpuGame = (totalGamePoints + rawGamePointDelta) / 2;
  const opponentGame = totalGamePoints - cpuGame;
  const cpuTotal = cpuGame + fixedDeclarationPoints(state, cpuPlayerId);
  const opponentTotal =
    opponentGame + fixedDeclarationPoints(state, opponent.playerId);

  return cpuTotal > opponentTotal;
}

function totalPlayableGamePoints(state: BelotState) {
  if (!state.trumpSuit) {
    return 0;
  }

  let total = 10;

  for (const player of state.players) {
    for (const card of player.hand) {
      total += belotCardPoints(card, state.trumpSuit);
    }

    for (const card of player.wonCards) {
      total += belotCardPoints(card, state.trumpSuit);
    }
  }

  for (const play of state.currentTrick) {
    total += belotCardPoints(play.card, state.trumpSuit);
  }

  return total;
}

function fixedDeclarationPoints(state: BelotState, playerId: string) {
  return (state.declarationsByPlayer[playerId] ?? []).reduce(
    (sum, declaration) => sum + declaration.points,
    0,
  );
}

export function belotCpuOrderCardsForSearch(
  cards: Card[],
  state: BelotState,
  maximizing: boolean,
) {
  if (!state.trumpSuit) {
    return cards;
  }

  const prioritizedCard = leadingTrumpShortVoidForceCard(cards, state);

  return cards.slice().sort((left, right) => {
    if (prioritizedCard) {
      if (left.id === prioritizedCard.id && right.id !== prioritizedCard.id) {
        return -1;
      }

      if (right.id === prioritizedCard.id && left.id !== prioritizedCard.id) {
        return 1;
      }
    }

    const leftScore = cardSearchOrderingScore(left, state, maximizing);
    const rightScore = cardSearchOrderingScore(right, state, maximizing);

    if (leftScore !== rightScore) {
      return maximizing ? rightScore - leftScore : leftScore - rightScore;
    }

    return left.id.localeCompare(right.id);
  });
}

function leadingTrumpShortVoidForceCard(cards: Card[], state: BelotState) {
  if (
    !state.trumpSuit ||
    state.currentTrick.length > 0 ||
    !state.currentTurnPlayerId
  ) {
    return undefined;
  }

  const currentPlayer = playerById(state, state.currentTurnPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== state.currentTurnPlayerId,
  );

  if (!opponent) {
    return undefined;
  }

  const currentPlayerTrumpCount = countTrumpCards(
    currentPlayer.hand,
    state.trumpSuit,
  );
  const opponentTrumpCount = countTrumpCards(opponent.hand, state.trumpSuit);

  if (currentPlayerTrumpCount >= opponentTrumpCount) {
    return undefined;
  }

  const opponentSuits = new Set(opponent.hand.map((card) => card.suit));
  const voidForcingCards = cards.filter(
    (card) => card.suit !== state.trumpSuit && !opponentSuits.has(card.suit),
  );

  if (voidForcingCards.length === 0) {
    return undefined;
  }

  return voidForcingCards
    .slice()
    .sort((left, right) =>
      compareCardsByCheapValue(left, right, state.trumpSuit!),
    )[0];
}

const belotCpuHandPlaySearchPolicy: BelotHandPlaySearchPolicy = {
  cheapOpeningSearchPlies,
  searchCards: belotCpuSearchCards,
  orderCards: belotCpuOrderCardsForSearch,
  cheapSearchCard: belotCpuCheapSearchCard,
};

export function belotCpuOrderRootCardsForSearch(
  cards: Card[],
  state: BelotState,
  stats: ReadonlyMap<string, BelotCpuRootCardSampleStats>,
) {
  if (!state.trumpSuit) {
    return cards;
  }

  return cards.slice().sort((left, right) => {
    const statsDelta = compareRootCardSampleStats(
      stats.get(left.id),
      stats.get(right.id),
    );

    if (statsDelta !== 0) {
      return statsDelta;
    }

    const leadingCardDelta = compareLeadingRootCards(left, right, state);

    if (leadingCardDelta !== 0) {
      return leadingCardDelta;
    }

    const heuristicDelta =
      cardSearchOrderingScore(right, state, true) -
      cardSearchOrderingScore(left, state, true);

    if (heuristicDelta !== 0) {
      return heuristicDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

function compareLeadingRootCards(left: Card, right: Card, state: BelotState) {
  if (!state.trumpSuit || state.currentTrick.length > 0) {
    return 0;
  }

  const leftTrump = left.suit === state.trumpSuit;
  const rightTrump = right.suit === state.trumpSuit;

  if (leftTrump !== rightTrump) {
    return Number(leftTrump) - Number(rightTrump);
  }

  const pointDelta =
    belotCardPoints(right, state.trumpSuit) -
    belotCardPoints(left, state.trumpSuit);

  if (pointDelta !== 0) {
    return pointDelta;
  }

  const strengthDelta =
    left.suit === right.suit
      ? compareBelotCards(right, left, state.trumpSuit)
      : 0;

  if (strengthDelta !== 0) {
    return strengthDelta;
  }

  return 0;
}

function createRootCardSampleStats(cards: Card[]) {
  return new Map<string, BelotCpuRootCardSampleStats>(
    cards.map((card) => [
      card.id,
      {
        sampleCount: 0,
        successCount: 0,
        totalWinningValue: 0,
      },
    ]),
  );
}

function updateRootCardSampleStats(
  stats: Map<string, BelotCpuRootCardSampleStats>,
  sampleResult: BelotRootSampleSearchResult,
) {
  for (const cardId of sampleResult.searchedCardIds) {
    const current = stats.get(cardId) ?? {
      sampleCount: 0,
      successCount: 0,
      totalWinningValue: 0,
    };
    const success = cardId === sampleResult.bestCardId;

    stats.set(cardId, {
      sampleCount: current.sampleCount + 1,
      successCount: current.successCount + (success ? 1 : 0),
      totalWinningValue:
        current.totalWinningValue + (success ? sampleResult.bestValue : 0),
    });
  }
}

function compareRootCardSampleStats(
  left: BelotCpuRootCardSampleStats | undefined,
  right: BelotCpuRootCardSampleStats | undefined,
) {
  const leftObserved = Boolean(left?.sampleCount);
  const rightObserved = Boolean(right?.sampleCount);

  if (leftObserved !== rightObserved) {
    return Number(rightObserved) - Number(leftObserved);
  }

  if (!left || !right || !leftObserved || !rightObserved) {
    return 0;
  }

  const successRateDelta =
    right.successCount / right.sampleCount -
    left.successCount / left.sampleCount;

  if (successRateDelta !== 0) {
    return successRateDelta;
  }

  const averageWinningValueDelta =
    averageRootCardWinningValue(right) - averageRootCardWinningValue(left);

  if (averageWinningValueDelta !== 0) {
    return averageWinningValueDelta;
  }

  return 0;
}

function averageRootCardWinningValue(stats: BelotCpuRootCardSampleStats) {
  return stats.successCount > 0
    ? stats.totalWinningValue / stats.successCount
    : 0;
}

function cardSearchOrderingScore(
  card: Card,
  state: BelotState,
  maximizing: boolean,
) {
  const currentPlayerScore =
    (wouldCurrentlyWin(card, state.currentTrick, state.trumpSuit!) ? 1000 : 0) +
    cardHeuristic(card, state.trumpSuit!);

  return maximizing ? currentPlayerScore : -currentPlayerScore;
}

function wouldCurrentlyWin(
  card: Card,
  trick: BelotTrickPlay[],
  trumpSuit: Suit,
) {
  if (trick.length === 0) {
    return false;
  }

  const winner = trickWinner(
    [...trick, { playerId: "candidate", card }],
    trumpSuit,
  );

  return winner.card.id === card.id;
}

function trickWinner(plays: BelotTrickPlay[], trumpSuit: Suit) {
  const trumpPlays = plays.filter((play) => play.card.suit === trumpSuit);
  const relevantPlays = trumpPlays.length
    ? trumpPlays
    : plays.filter((play) => play.card.suit === plays[0]?.card.suit);

  return relevantPlays.reduce((winner, play) =>
    compareBelotCards(play.card, winner.card, trumpSuit) > 0 ? play : winner,
  );
}

function cardHeuristic(card: Card, trumpSuit: Suit) {
  const nonTrumpHighCardBonus =
    card.suit !== trumpSuit
      ? (card.rank === "A" ? 4 : 0) + (card.rank === "X" ? 2 : 0)
      : 0;

  return (
    belotCardPoints(card, trumpSuit) +
    (card.suit === trumpSuit ? 10 : 0) +
    nonTrumpHighCardBonus
  );
}

function compareCardsByCheapValue(left: Card, right: Card, trumpSuit: Suit) {
  const heuristicDelta =
    cardHeuristic(left, trumpSuit) - cardHeuristic(right, trumpSuit);

  if (heuristicDelta !== 0) {
    return heuristicDelta;
  }

  const strengthDelta =
    left.suit === right.suit ? compareBelotCards(left, right, trumpSuit) : 0;

  if (strengthDelta !== 0) {
    return strengthDelta;
  }

  return left.id.localeCompare(right.id);
}

function highestCheapValueCard(cards: Card[], trumpSuit: Suit) {
  return cards
    .slice()
    .sort((left, right) => compareCardsByCheapValue(right, left, trumpSuit))[0];
}

function playerById(state: BelotState, playerId: string) {
  const player = state.players.find(
    (candidate) => candidate.playerId === playerId,
  );

  if (!player) {
    throw new Error("Player is not in this Belot game");
  }

  return player;
}
