import type { BelotDeclaration, Card, Rank, Suit } from "@card-games/shared";
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
  trumpMinCardsForStandardSuccess?: number;
  trumpMinExpectedValue?: number;
};

export const defaultBelotCpuMaxSearchPlies = 14;
const defaultMonteCarloSamples = 64;
const trumpMinExpectedValueForVoluntaryCall = 30;
const singleVisibleTrumpCardExpectedValuePenalty = 10;
const noVisibleTrumpCardExpectedValuePenalty = 20;
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

export type BelotCpuRootCardSampleStats = {
  sampleCount: number;
  successCount: number;
  totalWinningValue: number;
};

type BelotCpuRootCardValueStats = {
  sampleCount: number;
  totalValue: number;
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
    belotCpuMonteCarloSampleLimit(
      options.monteCarloSamples ?? defaultMonteCarloSamples,
      initialTrickHandCards,
    )
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
  return [...impossibleOpponentCardIds(state, opponentPlayerId)].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function belotCpuTrumpCallExpectedValueThreshold(
  visibleTrumpCardCount: number,
) {
  if (visibleTrumpCardCount <= 0) {
    return (
      trumpMinExpectedValueForVoluntaryCall +
      noVisibleTrumpCardExpectedValuePenalty
    );
  }

  if (visibleTrumpCardCount === 1) {
    return (
      trumpMinExpectedValueForVoluntaryCall +
      singleVisibleTrumpCardExpectedValuePenalty
    );
  }

  return trumpMinExpectedValueForVoluntaryCall;
}

function chooseTrumpAction(
  state: BelotState,
  player: BelotPlayerState,
  options: BelotCpuOptions,
): BelotAction | undefined {
  const rng = options.rng ?? Math.random;

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

    const shouldAcceptUpcard = shouldCallTrump(upcardCandidate);

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
        options,
        rng,
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
    const bestCandidate = candidates[0];
    const acceptedCandidate =
      state.phase === "mus"
        ? bestCandidate
        : bestAcceptedTrumpCandidate(candidates);

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
  options: BelotCpuOptions,
  rng: () => number,
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
        createTrumpRolloutSamples(
          state,
          cpuPlayerId,
          Math.max(1, belotCpuTrumpMonteCarloSamples(options)),
          rng,
        ),
      );

      return (
        shouldCallTrump(candidate) &&
        compareAcceptedTrumpCandidates(candidate, upcardCandidate) < 0
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
  const candidates = candidateSuits
    .map((suit) => {
      const samples = createTrumpRolloutSamples(
        state,
        cpuPlayerId,
        Math.max(1, belotCpuTrumpMonteCarloSamples(options)),
        rng,
      );

      return trumpSuitCandidate(
        state,
        cpuPlayerId,
        suit,
        isMus,
        options,
        samples,
      );
    })
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

function bestAcceptedTrumpCandidate(candidates: TrumpSuitCandidate[]) {
  return candidates
    .filter((candidate) => shouldCallTrump(candidate))
    .sort((left, right) => compareAcceptedTrumpCandidates(left, right))[0];
}

function shouldCallTrump(candidate: TrumpSuitCandidate) {
  return (
    candidate.score.expectedValue > trumpCallExpectedValueThreshold(candidate)
  );
}

function trumpCallExpectedValueThreshold(candidate: TrumpSuitCandidate) {
  return belotCpuTrumpCallExpectedValueThreshold(candidate.trumpCardCount);
}

function countTrumpCards(hand: Card[], trumpSuit: Suit) {
  return hand.filter((card) => card.suit === trumpSuit).length;
}

function compareAcceptedTrumpCandidates(
  left: TrumpSuitCandidate,
  right: TrumpSuitCandidate,
) {
  return compareTrumpCandidates(left, right);
}

function compareTrumpCandidates(
  left: TrumpSuitCandidate,
  right: TrumpSuitCandidate,
) {
  const expectedValueDelta =
    right.score.expectedValue - left.score.expectedValue;

  if (expectedValueDelta !== 0) {
    return expectedValueDelta;
  }

  const successRateDelta = right.score.successRate - left.score.successRate;

  if (successRateDelta !== 0) {
    return successRateDelta;
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
  const initialValue = evaluateScoreDifferential(state, cpuPlayerId);
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
  const successes = results.filter((result) =>
    belotCpuTrumpCandidateSucceeded(result, initialValue),
  ).length;

  return {
    expectedValue:
      results.reduce((sum, result) => sum + result.value - initialValue, 0) /
      results.length,
    successRate: successes / results.length,
  };
}

function evaluateScoreDifferential(state: BelotState, playerId: string) {
  const player = playerById(state, playerId);
  const opponent = state.players.find(
    (candidate) => candidate.playerId !== playerId,
  );

  if (!opponent) {
    return 0;
  }

  return player.totalScore - opponent.totalScore;
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
  const rootCardValueStats = createRootCardValueStats(searchCards);

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
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
      updateRootCardValueStats(rootCardValueStats, result.cardId, result.value);
    }

    updateRootCardSampleStats(rootCardStats, sampleResult);
  }

  return searchCards.slice().sort((left, right) => {
    const scoreDelta =
      averageRootCardValue(rootCardValueStats.get(right.id)) -
      averageRootCardValue(rootCardValueStats.get(left.id));

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

  const candidateCards = belotCpuNormalSearchCandidateCards(cards, state);

  if (candidateCards.length <= 1) {
    return candidateCards;
  }

  const keepCardIds = new Set<string>();
  const candidateCardIds = new Set(candidateCards.map((card) => card.id));
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

  return candidateCards.filter((card) => keepCardIds.has(card.id));
}

function belotCpuNormalSearchCandidateCards(cards: Card[], state: BelotState) {
  if (!state.trumpSuit) {
    return cards;
  }

  if (state.currentTrick.length === 0) {
    return belotCpuLeadSearchCandidateCards(cards, state);
  }

  const leadSuit = state.currentTrick[0]?.card.suit;
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

    if (leadSuit && card.suit === leadSuit && leadSuit !== state.trumpSuit) {
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

function belotCpuLeadSearchCandidateCards(cards: Card[], state: BelotState) {
  if (!state.trumpSuit || !state.currentTurnPlayerId) {
    return cards;
  }

  const opponent = state.players.find(
    (player) => player.playerId !== state.currentTurnPlayerId,
  );

  if (
    !opponent ||
    opponent.hand.length === 0 ||
    // Root pre-pruning clears unusedCards; sampled alpha-beta states keep them.
    (state.unusedCards?.length ?? 0) === 0
  ) {
    return cards;
  }

  const keepCardIds = new Set<string>();

  for (const suit of suits) {
    const suitCards = cards.filter((card) => card.suit === suit);

    if (suitCards.length === 0) {
      continue;
    }

    const representative = leadSuitRepresentativeCard(
      suitCards,
      opponent.hand,
      state.trumpSuit,
    );

    for (const card of representative ? [representative] : suitCards) {
      keepCardIds.add(card.id);
    }
  }

  return cards.filter((card) => keepCardIds.has(card.id));
}

function leadSuitRepresentativeCard(
  cards: Card[],
  opponentCards: Card[],
  trumpSuit: Suit,
) {
  const suit = cards[0]?.suit;

  if (!suit) {
    return undefined;
  }

  const weakest = weakestCard(cards, trumpSuit);
  const strongest = strongestCard(cards, trumpSuit);
  const opponentSuitCards = opponentCards.filter((card) => card.suit === suit);

  if (!weakest || !strongest) {
    return undefined;
  }

  if (opponentSuitCards.length === 0) {
    const opponentHasTrump = opponentCards.some(
      (card) => card.suit === trumpSuit,
    );

    return suit === trumpSuit || !opponentHasTrump ? strongest : weakest;
  }

  const weakestOpponentSuitCard = weakestCard(opponentSuitCards, trumpSuit);
  const strongestOpponentSuitCard = strongestCard(opponentSuitCards, trumpSuit);

  if (
    strongestOpponentSuitCard &&
    compareBelotCards(weakest, strongestOpponentSuitCard, trumpSuit) > 0
  ) {
    return strongest;
  }

  return weakestOpponentSuitCard &&
    compareBelotCards(weakestOpponentSuitCard, strongest, trumpSuit) > 0
    ? weakest
    : undefined;
}

function weakestCard(cards: Card[], trumpSuit: Suit) {
  return cards
    .slice()
    .sort((left, right) => compareBelotCards(left, right, trumpSuit))[0];
}

function strongestCard(cards: Card[], trumpSuit: Suit) {
  return cards
    .slice()
    .sort((left, right) => compareBelotCards(right, left, trumpSuit))[0];
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

function strongerWinningTrumpAgainstSuperiorOpponentTrump(
  winningCards: Card[],
  state: BelotState,
) {
  if (!state.trumpSuit || !state.currentTurnPlayerId) {
    return undefined;
  }

  const winningTrumps = winningCards.filter(
    (card) => card.suit === state.trumpSuit,
  );

  if (winningTrumps.length !== 2) {
    return undefined;
  }

  const opponent = state.players.find(
    (player) => player.playerId !== state.currentTurnPlayerId,
  );

  const hasSuperiorOpponentTrump = opponent?.hand.some(
    (opponentCard) =>
      opponentCard.suit === state.trumpSuit &&
      winningTrumps.every(
        (winningTrump) =>
          compareBelotCards(opponentCard, winningTrump, state.trumpSuit!) > 0,
      ),
  );

  if (!hasSuperiorOpponentTrump) {
    return undefined;
  }

  return winningTrumps
    .slice()
    .sort((left, right) => compareBelotCards(right, left, state.trumpSuit!))[0];
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
    const strongerTrumpResponse =
      strongerWinningTrumpAgainstSuperiorOpponentTrump(winningCards, state);
    const candidates = strongerTrumpResponse
      ? [strongerTrumpResponse]
      : preferredNonTrumpWinningResponseCard
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
    const forcedLeadCard = leadingTrumpShortVoidForceCard(cards, state);

    if (forcedLeadCard) {
      return forcedLeadCard;
    }

    const opponentSuits = new Set(opponent.hand.map((card) => card.suit));
    const sharedSuitNonTrumpCards = nonTrumpCards.filter((card) =>
      opponentSuits.has(card.suit),
    );

    if (sharedSuitNonTrumpCards.length) {
      return highestCheapValueCard(
        lowestPriorityHighCardsOpponentCanTake(
          sharedSuitNonTrumpCards,
          opponent.hand,
          state.trumpSuit,
        ),
        state.trumpSuit,
      );
    }

    const currentPlayerTrumpCount = countTrumpCards(
      currentPlayer.hand,
      state.trumpSuit,
    );
    const opponentTrumpCount = countTrumpCards(opponent.hand, state.trumpSuit);

    if (opponentTrumpCount < currentPlayerTrumpCount) {
      const trumpCards = cards.filter((card) => card.suit === state.trumpSuit);

      if (trumpCards.length) {
        return highestCheapValueCard(
          lowestPriorityHighCardsOpponentCanTake(
            trumpCards,
            opponent.hand,
            state.trumpSuit,
          ),
          state.trumpSuit,
        );
      }
    }
  }

  const candidates = nonTrumpCards.length ? nonTrumpCards : cards;

  return highestCheapValueCard(
    opponent
      ? lowestPriorityHighCardsOpponentCanTake(
          candidates,
          opponent.hand,
          state.trumpSuit,
        )
      : candidates,
    state.trumpSuit,
  );
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
  const impossibleOpponentCardIdsForSample = impossibleOpponentCardIds(
    state,
    opponent.playerId,
  );
  const unknownCards = unknownCardsForCpu(
    state,
    cpuPlayerId,
    opponentKnownCards,
  );
  const unknownPool = unknownCards.filter(
    (card) => !impossibleOpponentCardIdsForSample.has(card.id),
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
    const { cpuHiddenCards, opponentHand } = sampleTrumpRollout(
      unknownPool,
      cpuHiddenCount,
      opponentCardCount,
      rng,
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

function sampleTrumpRollout(
  unknownPool: Card[],
  cpuHiddenCount: number,
  opponentCardCount: number,
  rng: () => number,
) {
  const sampledCards = shuffleDeck(unknownPool, rng);
  const cpuHiddenCards = sampledCards.slice(0, cpuHiddenCount);

  return {
    cpuHiddenCards,
    opponentHand: sampledCards.slice(
      cpuHiddenCount,
      cpuHiddenCount + opponentCardCount,
    ),
  };
}

function* iterateRegularTrumpRollouts(
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

function* iterateTrumpRollouts(
  unknownPool: Card[],
  cpuHiddenCount: number,
  opponentCardCount: number,
): Generator<{ cpuHiddenCards: Card[]; opponentHand: Card[] }> {
  yield* iterateRegularTrumpRollouts(
    unknownPool,
    cpuHiddenCount,
    opponentCardCount,
  );
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

function impossibleOpponentCardIds(
  state: BelotState,
  opponentPlayerId: string,
) {
  const impossibleCardIds = impossibleOpponentCardIdsFromPlayHistory(
    state,
    opponentPlayerId,
  );

  for (const cardId of impossibleOpponentCardIdsFromDeclarations(
    state,
    opponentPlayerId,
  )) {
    impossibleCardIds.add(cardId);
  }

  return impossibleCardIds;
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

function impossibleOpponentCardIdsFromDeclarations(
  state: BelotState,
  opponentPlayerId: string,
) {
  const impossibleCardIds = new Set<string>();
  const trumpSuit = state.trumpSuit;
  const declared = state.declarationsByPlayer[opponentPlayerId];

  if (!trumpSuit || !declared) {
    return impossibleCardIds;
  }

  const actualPoints = sumBelotDeclarationPoints(declared);
  const knownCards = knownOpponentOriginalHandCards(state, opponentPlayerId);
  const knownCardIds = new Set(knownCards.map((card) => card.id));

  for (const card of belotDeck) {
    if (knownCardIds.has(card.id)) {
      continue;
    }

    const possibleDeclarations = autoSelectBelotDeclarations(
      [...knownCards, card],
      trumpSuit,
    );

    if (sumBelotDeclarationPoints(possibleDeclarations) > actualPoints) {
      impossibleCardIds.add(card.id);
    }
  }

  return impossibleCardIds;
}

function knownOpponentOriginalHandCards(
  state: BelotState,
  opponentPlayerId: string,
) {
  const knownCardsById = new Map<string, Card>();

  for (const declaration of state.declarationsByPlayer[opponentPlayerId] ??
    []) {
    for (const card of declaration.cards) {
      knownCardsById.set(card.id, card);
    }
  }

  for (const card of state.publicCardsByPlayer[opponentPlayerId] ?? []) {
    knownCardsById.set(card.id, card);
  }

  for (const play of state.currentTrick) {
    if (play.playerId === opponentPlayerId) {
      knownCardsById.set(play.card.id, play.card);
    }
  }

  for (const trick of state.completedTricks) {
    for (const play of trick.cards) {
      if (play.playerId === opponentPlayerId) {
        knownCardsById.set(play.card.id, play.card);
      }
    }
  }

  return [...knownCardsById.values()];
}

function sumBelotDeclarationPoints(declarations: BelotDeclaration[]) {
  return declarations.reduce((sum, declaration) => sum + declaration.points, 0);
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

export function belotCpuTrumpCandidateSucceeded(
  result: {
    value: number;
    callerFell?: boolean;
  },
  initialValue = 0,
) {
  if (result.callerFell !== undefined) {
    return !result.callerFell;
  }

  return result.value - initialValue > 0;
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

export function belotCpuForcedSearchCard(cards: Card[], state: BelotState) {
  const leadingTrumpShortVoidCard = leadingTrumpShortVoidForceCard(
    cards,
    state,
  );

  if (leadingTrumpShortVoidCard) {
    return leadingTrumpShortVoidCard;
  }

  const opponentVoidDiscard = opponentVoidSuitCheapDiscard(cards, state);

  if (opponentVoidDiscard) {
    return opponentVoidDiscard;
  }

  return undefined;
}

function opponentVoidSuitCheapDiscard(cards: Card[], state: BelotState) {
  if (
    !state.trumpSuit ||
    state.currentTrick.length === 0 ||
    !state.currentTurnPlayerId
  ) {
    return undefined;
  }

  const leadSuit = state.currentTrick[0]?.card.suit;

  if (!leadSuit) {
    return undefined;
  }

  const currentPlayer = playerById(state, state.currentTurnPlayerId);

  if (
    currentPlayer.hand.some(
      (card) => card.suit === leadSuit || card.suit === state.trumpSuit,
    )
  ) {
    return undefined;
  }

  const opponent = state.players.find(
    (player) => player.playerId !== state.currentTurnPlayerId,
  );

  if (!opponent) {
    return undefined;
  }

  const opponentSuits = new Set(opponent.hand.map((card) => card.suit));
  const candidates = cards.filter(
    (card) =>
      card.rank !== "A" && card.rank !== "X" && !opponentSuits.has(card.suit),
  );

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates
    .slice()
    .sort((left, right) =>
      compareCardsByCheapValue(left, right, state.trumpSuit!),
    )[0];
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
    (card) =>
      card.suit !== state.trumpSuit &&
      card.rank !== "A" &&
      card.rank !== "X" &&
      !opponentSuits.has(card.suit),
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
  forcedSearchCard: belotCpuForcedSearchCard,
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

function createRootCardValueStats(cards: Card[]) {
  return new Map<string, BelotCpuRootCardValueStats>(
    cards.map((card) => [
      card.id,
      {
        sampleCount: 0,
        totalValue: 0,
      },
    ]),
  );
}

function updateRootCardValueStats(
  stats: Map<string, BelotCpuRootCardValueStats>,
  cardId: string,
  value: number,
) {
  const current = stats.get(cardId) ?? {
    sampleCount: 0,
    totalValue: 0,
  };

  stats.set(cardId, {
    sampleCount: current.sampleCount + 1,
    totalValue: current.totalValue + value,
  });
}

function averageRootCardValue(stats: BelotCpuRootCardValueStats | undefined) {
  return stats && stats.sampleCount > 0
    ? stats.totalValue / stats.sampleCount
    : -belotHandPlaySearchMaxUtility;
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
  return belotCardPoints(card, trumpSuit);
}

function lowestPriorityHighCardsOpponentCanTake(
  cards: Card[],
  opponentCards: Card[],
  trumpSuit: Suit,
) {
  const saferCards = cards.filter(
    (card) => !highValueCardOpponentCanTake(card, opponentCards, trumpSuit),
  );

  return saferCards.length ? saferCards : cards;
}

function highValueCardOpponentCanTake(
  card: Card,
  opponentCards: Card[],
  trumpSuit: Suit,
) {
  if (belotCardPoints(card, trumpSuit) < 10) {
    return false;
  }

  return opponentCards.some(
    (opponentCard) =>
      opponentCard.suit === card.suit &&
      compareBelotCards(opponentCard, card, trumpSuit) > 0,
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
