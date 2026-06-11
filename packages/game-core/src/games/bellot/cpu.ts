import type { Card, Rank, Suit } from "@card-games/shared";
import { suits } from "@card-games/shared";

import { createDeck, shuffleDeck } from "../../cards/deck";
import {
  applyBellotAction,
  autoSelectBellotDeclarations,
  bellotCardPoints,
  compareBellotCards,
  legalBellotCards,
} from "./bellot";
import type {
  BellotAction,
  BellotPlayerState,
  BellotState,
  BellotTrickPlay,
} from "./types";

export type BellotCpuOptions = {
  maxSearchPlies?: number;
  monteCarloSamples?: number;
  rng?: () => number;
  trumpSearchPlies?: number;
  trumpMonteCarloSamples?: number;
  trumpAcceptMinSuccessRate?: number;
  trumpChooseMinSuccessRate?: number;
  trumpHighSuccessRate?: number;
  trumpMinCardsForStandardSuccess?: number;
  trumpMinExpectedValue?: number;
};

const defaultMaxSearchPlies = 10;
const trumpSearchPlyBonus = 2;
const defaultMonteCarloSamples = 64;
const defaultTrumpMonteCarloSamples = 64;
const defaultTrumpMinSuccessRate = 0.85;
const defaultTrumpHighSuccessRate = 0.95;
const defaultTrumpMinCardsForStandardSuccess = 3;
const defaultTrumpMinExpectedValue = 0;
const initialTrickHandCards = 10;
const sampleIncreasePerMissingCard = 0.2;
const maxUtility = 1_000_000;
const bellotDeck = createDeck();
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

type TrumpCallThresholds = {
  minSuccessRate: number;
  highSuccessRate: number;
  minTrumpCards: number;
  minExpectedValue: number;
};

type BellotSearchResult = {
  value: number;
  callerFell?: boolean;
};

type BellotTranspositionEntry = {
  depth: number;
  result: BellotSearchResult;
};

type BellotTranspositionTable = Map<string, BellotTranspositionEntry>;

export function bellotCpuMonteCarloSampleLimit(
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

export function chooseBellotCpuAction(
  state: BellotState,
  cpuPlayerId: string,
  options: BellotCpuOptions = {},
): BellotAction | undefined {
  const player = state.players.find(
    (candidate) => candidate.playerId === cpuPlayerId,
  );

  if (!player) {
    throw new Error("CPU player is not in this Bellot game");
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
      declarations: autoSelectBellotDeclarations(player.hand, state.trumpSuit),
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

export function inferBellotCpuImpossibleOpponentCardIds(
  state: BellotState,
  opponentPlayerId: string,
) {
  return [
    ...impossibleOpponentCardIdsFromPlayHistory(state, opponentPlayerId),
  ].sort((left, right) => left.localeCompare(right));
}

function chooseTrumpAction(
  state: BellotState,
  player: BellotPlayerState,
  options: BellotCpuOptions,
): BellotAction | undefined {
  const rng = options.rng ?? Math.random;
  const minExpectedValue =
    options.trumpMinExpectedValue ?? defaultTrumpMinExpectedValue;
  const highSuccessRate =
    options.trumpHighSuccessRate ?? defaultTrumpHighSuccessRate;
  const minTrumpCards =
    options.trumpMinCardsForStandardSuccess ??
    defaultTrumpMinCardsForStandardSuccess;

  if (state.phase === "trump-round-one" && state.upcard) {
    const score = scoreTrumpCandidate(
      state,
      player.playerId,
      state.upcard.suit,
      false,
      options,
      rng,
    );
    const minSuccessRate =
      options.trumpAcceptMinSuccessRate ?? defaultTrumpMinSuccessRate;
    const trumpCardCount = countTrumpCards(player.hand, state.upcard.suit);
    const thresholds = {
      minSuccessRate,
      highSuccessRate,
      minTrumpCards,
      minExpectedValue,
    };

    return shouldCallTrump({
      score,
      trumpCardCount,
      thresholds,
    })
      ? { type: "trump-accept-upcard", playerId: player.playerId }
      : { type: "trump-pass", playerId: player.playerId };
  }

  if (
    (state.phase === "trump-round-two" || state.phase === "mus") &&
    state.upcard
  ) {
    const candidates = trumpSuitCandidates(
      state,
      player.playerId,
      state.upcard.suit,
      state.phase === "mus",
      options,
      rng,
    );
    const minSuccessRate =
      options.trumpChooseMinSuccessRate ?? defaultTrumpMinSuccessRate;
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

function trumpSuitCandidates(
  state: BellotState,
  cpuPlayerId: string,
  excludedSuit: Suit,
  isMus: boolean,
  options: BellotCpuOptions,
  rng: () => number,
) {
  const cpu = playerById(state, cpuPlayerId);
  const candidates = suits
    .filter((suit) => suit !== excludedSuit)
    .map((suit) => ({
      suit,
      score: scoreTrumpCandidate(state, cpuPlayerId, suit, isMus, options, rng),
      trumpCardCount: countTrumpCards(cpu.hand, suit),
    }))
    .sort(compareTrumpCandidates);

  if (candidates.length === 0) {
    throw new Error("No selectable trump suit is available");
  }

  return candidates;
}

function scoreTrumpCandidate(
  state: BellotState,
  cpuPlayerId: string,
  trumpSuit: Suit,
  isMus: boolean,
  options: BellotCpuOptions,
  rng: () => number,
) {
  return averageTrumpRolloutScore(
    state,
    cpuPlayerId,
    trumpSuit,
    isMus,
    options,
    rng,
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
  const expectedValueDelta = right.score.expectedValue - left.score.expectedValue;

  if (expectedValueDelta !== 0) {
    return expectedValueDelta;
  }

  return right.score.successRate - left.score.successRate;
}

function averageTrumpRolloutScore(
  state: BellotState,
  cpuPlayerId: string,
  trumpSuit: Suit,
  isMus: boolean,
  options: BellotCpuOptions,
  rng: () => number,
): TrumpCandidateScore {
  const sampleCount =
    options.trumpMonteCarloSamples ??
    options.monteCarloSamples ??
    defaultTrumpMonteCarloSamples;
  const samples = createTrumpRolloutStates(
    state,
    cpuPlayerId,
    trumpSuit,
    isMus,
    Math.max(1, sampleCount),
    rng,
  );
  const searchPlies =
    options.trumpSearchPlies ??
    (options.maxSearchPlies ?? defaultMaxSearchPlies) + trumpSearchPlyBonus;
  const transpositions: BellotTranspositionTable = new Map();
  const results = samples.map((sample) =>
    alphaBetaResult(
      sample,
      cpuPlayerId,
      searchPlies,
      -maxUtility,
      maxUtility,
      transpositions,
    ),
  );
  const successes = results.filter((result) =>
    callerAvoidedFall(result),
  ).length;

  return {
    expectedValue:
      results.reduce((sum, result) => sum + result.value, 0) / results.length,
    successRate: successes / results.length,
  };
}

function callerAvoidedFall(result: BellotSearchResult) {
  return result.callerFell === undefined ? result.value > 0 : !result.callerFell;
}

function createTrumpRolloutStates(
  state: BellotState,
  cpuPlayerId: string,
  trumpSuit: Suit,
  isMus: boolean,
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
    const sampledCpuHiddenCards = sample.cpuHiddenCards;
    const sampledOpponentHand = sample.opponentHand;
    const sampledCpuHand = [...cpu.hand, ...sampledCpuHiddenCards];
    const declarationsByPlayer = {
      [cpuPlayerId]: autoSelectBellotDeclarations(sampledCpuHand, trumpSuit),
      [opponent.playerId]: autoSelectBellotDeclarations(
        sampledOpponentHand,
        trumpSuit,
      ),
    };

    return {
      ...state,
      phase: "trick-play" as const,
      players: state.players.map((player) =>
        player.playerId === cpuPlayerId
          ? { ...player, hand: sampledCpuHand, hiddenCards: [] }
          : { ...player, hand: sampledOpponentHand, hiddenCards: [] },
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
  });
}

function chooseCardForTrick(
  state: BellotState,
  cpuPlayerId: string,
  options: BellotCpuOptions,
) {
  if (!state.trumpSuit) {
    throw new Error("Cannot choose a card before trump is selected");
  }

  const cpu = playerById(state, cpuPlayerId);
  const legalCards = legalBellotCards(
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
  const maxSearchPlies = options.maxSearchPlies ?? defaultMaxSearchPlies;
  const samples = createDeterminizedStates(
    state,
    cpuPlayerId,
    bellotCpuMonteCarloSampleLimit(
      options.monteCarloSamples ?? defaultMonteCarloSamples,
      cpu.hand.length,
    ),
    rng,
  );
  const searchCards = bellotCpuSearchCards(legalCards, state);
  const scores = new Map(searchCards.map((card) => [card.id, 0]));
  const transpositions: BellotTranspositionTable = new Map();

  for (const sample of samples) {
    const sampleSearchCards = bellotCpuSearchCards(searchCards, sample);

    for (const card of orderCardsForSearch(
      sampleSearchCards,
      sample,
      cpuPlayerId,
    )) {
      const next = applyBellotAction(sample, {
        type: "play-card",
        playerId: cpuPlayerId,
        cardId: card.id,
      });
      const value = alphaBeta(
        next,
        cpuPlayerId,
        maxSearchPlies - 1,
        -maxUtility,
        maxUtility,
        transpositions,
      );

      scores.set(card.id, (scores.get(card.id) ?? 0) + value);
    }
  }

  return searchCards.slice().sort((left, right) => {
    const scoreDelta = (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return (
      cardHeuristic(right, state.trumpSuit!) -
      cardHeuristic(left, state.trumpSuit!)
    );
  })[0];
}

function alphaBeta(
  state: BellotState,
  cpuPlayerId: string,
  depth: number,
  alpha: number,
  beta: number,
  transpositions: BellotTranspositionTable,
): number {
  return alphaBetaResult(
    state,
    cpuPlayerId,
    depth,
    alpha,
    beta,
    transpositions,
  ).value;
}

function alphaBetaResult(
  state: BellotState,
  cpuPlayerId: string,
  depth: number,
  alpha: number,
  beta: number,
  transpositions: BellotTranspositionTable,
): BellotSearchResult {
  const transpositionKey = bellotTranspositionKey(state, cpuPlayerId);
  const cached = transpositions.get(transpositionKey);

  if (cached && cached.depth >= depth) {
    return cached.result;
  }

  if (
    (depth <= 0 && state.currentTrick.length === 0) ||
    state.phase === "hand-complete" ||
    state.phase === "finished"
  ) {
    const result = evaluateSearchLeaf(state, cpuPlayerId);
    transpositions.set(transpositionKey, { depth, result });
    return result;
  }

  if (
    state.phase !== "trick-play" ||
    !state.trumpSuit ||
    !state.currentTurnPlayerId
  ) {
    const result = evaluateSearchLeaf(state, cpuPlayerId);
    transpositions.set(transpositionKey, { depth, result });
    return result;
  }

  const currentPlayer = playerById(state, state.currentTurnPlayerId);
  const legalCards = legalBellotCards(
    currentPlayer.hand,
    state.currentTrick,
    state.trumpSuit,
  );

  if (legalCards.length === 0) {
    const result = evaluateSearchLeaf(state, cpuPlayerId);
    transpositions.set(transpositionKey, { depth, result });
    return result;
  }

  const searchCards = bellotCpuSearchCards(legalCards, state);
  const maximizing = state.currentTurnPlayerId === cpuPlayerId;
  let best: BellotSearchResult = {
    value: maximizing ? -maxUtility : maxUtility,
  };
  let pruned = false;

  for (const card of orderCardsForSearch(
    searchCards,
    state,
    currentPlayer.playerId,
  )) {
    const next = applyBellotAction(state, {
      type: "play-card",
      playerId: currentPlayer.playerId,
      cardId: card.id,
    });
    const nextDepth =
      depth <= 0 && state.currentTrick.length > 0 ? depth : depth - 1;
    const result = alphaBetaResult(
      next,
      cpuPlayerId,
      nextDepth,
      alpha,
      beta,
      transpositions,
    );

    if (searchResultBetter(result, best, maximizing)) {
      best = result;
    }

    if (maximizing) {
      alpha = Math.max(alpha, result.value);
    } else {
      beta = Math.min(beta, result.value);
    }

    if (beta <= alpha) {
      pruned = true;
      break;
    }
  }

  // Cutoff nodes only prove a bound; store exact results from fully searched nodes.
  if (!pruned) {
    transpositions.set(transpositionKey, { depth, result: best });
  }

  return best;
}

function evaluateSearchLeaf(
  state: BellotState,
  cpuPlayerId: string,
): BellotSearchResult {
  return {
    value: evaluateState(state, cpuPlayerId),
    callerFell:
      state.callerPlayerId === cpuPlayerId
        ? state.lastHandResult?.callerFell
        : undefined,
  };
}

function searchResultBetter(
  candidate: BellotSearchResult,
  current: BellotSearchResult,
  maximizing: boolean,
) {
  if (candidate.value !== current.value) {
    return maximizing
      ? candidate.value > current.value
      : candidate.value < current.value;
  }

  const candidateAvoidedFall = callerAvoidedFall(candidate);
  const currentAvoidedFall = callerAvoidedFall(current);

  if (candidateAvoidedFall === currentAvoidedFall) {
    return false;
  }

  return maximizing ? candidateAvoidedFall : !candidateAvoidedFall;
}

export function bellotCpuSearchCards(cards: Card[], state: BellotState) {
  if (!state.trumpSuit || cards.length <= 2) {
    return cards;
  }

  const keepCardIds = new Set<string>();
  const candidateCardIds = new Set(cards.map((card) => card.id));
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
        const card = bellotDeck.find(
          (candidate) => candidate.suit === suit && candidate.rank === rank,
        );

        if (card && connectedCardIds.has(card.id)) {
          run.push(card);
          continue;
        }

        addSearchCardRangeEndpoints(keepCardIds, run, candidateCardIds);
        run = [];
      }

      addSearchCardRangeEndpoints(keepCardIds, run, candidateCardIds);
    }
  }

  return cards.filter((card) => keepCardIds.has(card.id));
}

function addSearchCardRangeEndpoints(
  keepCardIds: Set<string>,
  run: Card[],
  candidateCardIds: Set<string>,
) {
  const playableCards = run.filter((card) => candidateCardIds.has(card.id));
  const first = playableCards[0];
  const last = playableCards[playableCards.length - 1];

  if (first) {
    keepCardIds.add(first.id);
  }

  if (last) {
    keepCardIds.add(last.id);
  }
}

function knownPlayedOrDeadCards(state: BellotState) {
  const cards: Card[] = [];

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
  state: BellotState,
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
  const unknownPool = unknownCardsForCpu(
    state,
    cpuPlayerId,
    opponentKnownCards,
  ).filter((card) => !impossibleOpponentCardIds.has(card.id));
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

    return {
      ...state,
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

function bellotTranspositionKey(state: BellotState, cpuPlayerId: string) {
  const playersKey = state.players
    .map((player) =>
      [
        player.playerId,
        cardSetKey(player.hand),
        cardSetKey(player.hiddenCards),
        cardSetKey(player.wonCards),
        player.tricksWon,
        player.totalScore,
        declarationPoints(state, player.playerId),
      ].join(":"),
    )
    .join("|");
  const currentTrickKey = state.currentTrick
    .map((play) => `${play.playerId}:${play.card.id}`)
    .join(",");
  const completedCardsKey = cardSetKey(
    state.completedTricks.flatMap((trick) =>
      trick.cards.map((play) => play.card),
    ),
  );
  const lastHandKey = state.lastHandResult
    ? [
        state.lastHandResult.callerPlayerId,
        state.lastHandResult.opponentPlayerId,
        state.lastHandResult.callerFell,
        state.lastHandResult.callerFellOnGame,
        recordNumberKey(state.lastHandResult.handScoreByPlayer),
      ].join(":")
    : "";

  return [
    cpuPlayerId,
    state.phase,
    state.trumpSuit ?? "",
    state.callerPlayerId ?? "",
    state.currentTurnPlayerId ?? "",
    state.winnerPlayerId ?? "",
    state.isMus,
    state.upcard?.id ?? "",
    state.completedTricks.length,
    completedCardsKey,
    currentTrickKey,
    playersKey,
    lastHandKey,
  ].join("#");
}

function recordNumberKey(record: Record<string, number>) {
  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(",");
}

function impossibleOpponentCardIdsFromPlayHistory(
  state: BellotState,
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

  return impossibleCardIds;
}

function addImpossibleCardsFromResponse(
  impossibleCardIds: Set<string>,
  plays: BellotTrickPlay[],
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

function unknownCardsForCpu(
  state: BellotState,
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
  state: BellotState,
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

function evaluateState(state: BellotState, cpuPlayerId: string) {
  const cpu = playerById(state, cpuPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== cpuPlayerId,
  );

  if (!opponent) {
    return 0;
  }

  if (state.winnerPlayerId === cpuPlayerId) {
    return maxUtility / 2;
  }

  if (state.winnerPlayerId && state.winnerPlayerId !== cpuPlayerId) {
    return -maxUtility / 2;
  }

  const handScoreDelta = state.lastHandResult
    ? (state.lastHandResult.handScoreByPlayer[cpuPlayerId] ?? 0) -
      (state.lastHandResult.handScoreByPlayer[opponent.playerId] ?? 0)
    : 0;
  const totalScoreDelta = cpu.totalScore - opponent.totalScore;
  const declarationDelta =
    declarationPoints(state, cpuPlayerId) -
    declarationPoints(state, opponent.playerId);
  const gamePointDelta = state.trumpSuit
    ? capturedPoints(cpu, state) - capturedPoints(opponent, state)
    : 0;
  const handPointDelta = state.trumpSuit
    ? remainingHandPotential(cpu.hand, state.trumpSuit) -
      remainingHandPotential(opponent.hand, state.trumpSuit)
    : 0;
  const trickDelta = cpu.tricksWon - opponent.tricksWon;
  const callerPressure = callerMarginPressure(state, cpuPlayerId);

  return (
    handScoreDelta * 12 +
    totalScoreDelta * 2 +
    declarationDelta * 1.4 +
    gamePointDelta * 2.2 +
    handPointDelta * 0.45 +
    trickDelta * 5 +
    callerPressure
  );
}

function declarationPoints(state: BellotState, playerId: string) {
  return (state.declarationsByPlayer[playerId] ?? []).reduce(
    (sum, declaration) => sum + declaration.points,
    0,
  );
}

function capturedPoints(player: BellotPlayerState, state: BellotState) {
  if (!state.trumpSuit) {
    return 0;
  }

  return player.wonCards.reduce(
    (sum, card) => sum + bellotCardPoints(card, state.trumpSuit!),
    0,
  );
}

function remainingHandPotential(hand: Card[], trumpSuit: Suit) {
  return hand.reduce((sum, card) => sum + cardHeuristic(card, trumpSuit), 0);
}

function callerMarginPressure(state: BellotState, cpuPlayerId: string) {
  if (!state.callerPlayerId || !state.trumpSuit) {
    return 0;
  }

  const caller = playerById(state, state.callerPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== state.callerPlayerId,
  );

  if (!opponent) {
    return 0;
  }

  const callerTotal =
    capturedPoints(caller, state) + declarationPoints(state, caller.playerId);
  const opponentTotal =
    capturedPoints(opponent, state) +
    declarationPoints(state, opponent.playerId);
  const margin = callerTotal - opponentTotal;

  return state.callerPlayerId === cpuPlayerId ? margin * 0.9 : -margin * 0.9;
}

function orderCardsForSearch(
  cards: Card[],
  state: BellotState,
  playerId: string,
) {
  if (!state.trumpSuit) {
    return cards;
  }

  return cards.slice().sort((left, right) => {
    const leftWin = wouldCurrentlyWin(
      left,
      state.currentTrick,
      state.trumpSuit!,
    );
    const rightWin = wouldCurrentlyWin(
      right,
      state.currentTrick,
      state.trumpSuit!,
    );

    if (leftWin !== rightWin) {
      return playerId === state.currentTurnPlayerId
        ? Number(rightWin) - Number(leftWin)
        : Number(leftWin) - Number(rightWin);
    }

    return (
      cardHeuristic(right, state.trumpSuit!) -
      cardHeuristic(left, state.trumpSuit!)
    );
  });
}

function wouldCurrentlyWin(
  card: Card,
  trick: BellotTrickPlay[],
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

function trickWinner(plays: BellotTrickPlay[], trumpSuit: Suit) {
  const trumpPlays = plays.filter((play) => play.card.suit === trumpSuit);
  const relevantPlays = trumpPlays.length
    ? trumpPlays
    : plays.filter((play) => play.card.suit === plays[0]?.card.suit);

  return relevantPlays.reduce((winner, play) =>
    compareBellotCards(play.card, winner.card, trumpSuit) > 0 ? play : winner,
  );
}

function cardHeuristic(card: Card, trumpSuit: Suit) {
  return (
    bellotCardPoints(card, trumpSuit) +
    (card.suit === trumpSuit ? 10 : 0) +
    (card.rank === "A" ? 4 : 0) +
    (card.rank === "X" ? 2 : 0)
  );
}

function playerById(state: BellotState, playerId: string) {
  const player = state.players.find(
    (candidate) => candidate.playerId === playerId,
  );

  if (!player) {
    throw new Error("Player is not in this Bellot game");
  }

  return player;
}
