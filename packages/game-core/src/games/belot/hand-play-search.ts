import type { Card } from "@card-games/shared";

import {
  applyBelotAction,
  calculateBelotHandResult,
  legalBelotCards,
} from "./belot";
import type { BelotState, BelotTrickPlay } from "./types";

export const belotHandPlaySearchMaxUtility = 1_000_000;
const maxBelotHandPlayTranspositionEntries = 1_000_000;
const minBelotHandPlayTranspositionDepth = 2;
const belotCardBitById = new Map<string, number>(
  ["acorns", "bells", "hearts", "leaves"].flatMap((suit, suitIndex) =>
    ["VII", "VIII", "IX", "X", "U", "O", "K", "A"].map((rank, rankIndex) => [
      `${rank}-${suit}`,
      2 ** (suitIndex * 8 + rankIndex),
    ]),
  ),
);

export type BelotHandPlaySearchPolicy = {
  cheapOpeningSearchPlies: number;
  searchCards: (cards: Card[], state: BelotState) => Card[];
  orderCards: (cards: Card[], state: BelotState, maximizing: boolean) => Card[];
  cheapSearchCard: (cards: Card[], state: BelotState) => Card;
  forcedSearchCard?: (cards: Card[], state: BelotState) => Card | undefined;
};

export type BelotHandPlaySearchContext = {
  closingSearchPlies: number;
  policy: BelotHandPlaySearchPolicy;
  transpositionTable: Map<string, BelotHandPlayTranspositionEntry>;
};

export type BelotHandPlaySearchResult = {
  value: number;
  callerFell?: boolean;
  hasSchuster?: boolean;
};

export type BelotHandPlayTranspositionBound = "exact" | "lower" | "upper";

export type BelotHandPlayTranspositionEntry = {
  bound: BelotHandPlayTranspositionBound;
  value: number;
  callerFell?: boolean;
  hasSchuster?: boolean;
};

export function createBelotHandPlaySearchContext(
  depth: number,
  policy: BelotHandPlaySearchPolicy,
): BelotHandPlaySearchContext {
  return {
    closingSearchPlies: Math.max(0, depth - policy.cheapOpeningSearchPlies),
    policy,
    transpositionTable: new Map(),
  };
}

export function belotHandPlayAlphaBetaValue(
  state: BelotState,
  maximizingPlayerId: string,
  depth: number,
  alpha: number,
  beta: number,
  context: BelotHandPlaySearchContext,
): number {
  return belotHandPlayAlphaBetaResult(
    state,
    maximizingPlayerId,
    depth,
    alpha,
    beta,
    context,
  ).value;
}

export function belotHandPlayAlphaBetaResult(
  state: BelotState,
  maximizingPlayerId: string,
  depth: number,
  alpha: number,
  beta: number,
  context: BelotHandPlaySearchContext,
): BelotHandPlaySearchResult {
  if (state.phase === "hand-complete" || state.phase === "finished") {
    return evaluateSearchLeaf(state, maximizingPlayerId);
  }

  if (
    state.phase !== "trick-play" ||
    !state.trumpSuit ||
    !state.currentTurnPlayerId
  ) {
    return evaluateSearchLeaf(state, maximizingPlayerId);
  }

  const dominantLeaderResult = fastForwardDominantTrickLeader(
    state,
    maximizingPlayerId,
  );

  if (dominantLeaderResult) {
    return dominantLeaderResult;
  }

  const currentPlayer = playerById(state, state.currentTurnPlayerId);
  const legalCards = legalBelotCards(
    currentPlayer.hand,
    state.currentTrick,
    state.trumpSuit,
  );

  if (legalCards.length === 0) {
    return evaluateSearchLeaf(state, maximizingPlayerId);
  }

  const forcedCard = context.policy.forcedSearchCard?.(legalCards, state);

  if (forcedCard) {
    const next = applyBelotAction(state, {
      type: "play-card",
      playerId: currentPlayer.playerId,
      cardId: forcedCard.id,
    });

    return belotHandPlayAlphaBetaResult(
      next,
      maximizingPlayerId,
      depth - 1,
      alpha,
      beta,
      context,
    );
  }

  if (shouldUseCheapSearchMove(state, depth, context)) {
    const card = context.policy.cheapSearchCard(legalCards, state);
    const next = applyBelotAction(state, {
      type: "play-card",
      playerId: currentPlayer.playerId,
      cardId: card.id,
    });

    return belotHandPlayAlphaBetaResult(
      next,
      maximizingPlayerId,
      depth,
      alpha,
      beta,
      context,
    );
  }

  const originalAlpha = alpha;
  const originalBeta = beta;
  const transpositionKey =
    depth >= minBelotHandPlayTranspositionDepth
      ? belotHandPlayTranspositionKey(state, maximizingPlayerId, depth)
      : undefined;

  if (transpositionKey) {
    const transpositionEntry = context.transpositionTable.get(transpositionKey);

    if (transpositionEntry) {
      if (transpositionEntry.bound === "exact") {
        return {
          value: transpositionEntry.value,
          callerFell: transpositionEntry.callerFell,
          hasSchuster: transpositionEntry.hasSchuster,
        };
      }

      if (transpositionEntry.bound === "lower") {
        alpha = Math.max(alpha, transpositionEntry.value);
      } else {
        beta = Math.min(beta, transpositionEntry.value);
      }

      if (alpha >= beta) {
        return {
          value: transpositionEntry.value,
          callerFell: transpositionEntry.callerFell,
          hasSchuster: transpositionEntry.hasSchuster,
        };
      }
    }
  }

  const searchCards = context.policy.searchCards(legalCards, state);
  const maximizing = state.currentTurnPlayerId === maximizingPlayerId;
  let best: BelotHandPlaySearchResult = {
    value: maximizing
      ? -belotHandPlaySearchMaxUtility
      : belotHandPlaySearchMaxUtility,
  };

  for (const card of context.policy.orderCards(
    searchCards,
    state,
    maximizing,
  )) {
    const next = applyBelotAction(state, {
      type: "play-card",
      playerId: currentPlayer.playerId,
      cardId: card.id,
    });
    const result = belotHandPlayAlphaBetaResult(
      next,
      maximizingPlayerId,
      depth - 1,
      alpha,
      beta,
      context,
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
      break;
    }
  }

  if (transpositionKey) {
    rememberBelotHandPlayTransposition(
      context,
      transpositionKey,
      best,
      originalAlpha,
      originalBeta,
    );
  }

  return best;
}

function rememberBelotHandPlayTransposition(
  context: BelotHandPlaySearchContext,
  key: string,
  result: BelotHandPlaySearchResult,
  alpha: number,
  beta: number,
) {
  let bound: BelotHandPlayTranspositionBound = "exact";

  if (result.value <= alpha) {
    bound = "upper";
  } else if (result.value >= beta) {
    bound = "lower";
  }

  if (
    !context.transpositionTable.has(key) &&
    context.transpositionTable.size >= maxBelotHandPlayTranspositionEntries
  ) {
    const oldestKey = context.transpositionTable.keys().next().value;

    if (oldestKey) {
      context.transpositionTable.delete(oldestKey);
    }
  }

  const entry: BelotHandPlayTranspositionEntry = {
    bound,
    value: result.value,
  };

  if (bound === "exact" && result.callerFell !== undefined) {
    entry.callerFell = result.callerFell;
  }

  if (result.hasSchuster) {
    entry.hasSchuster = true;
  }

  context.transpositionTable.set(key, entry);
}

function belotHandPlayTranspositionKey(
  state: BelotState,
  maximizingPlayerId: string,
  depth: number,
) {
  return [
    depth,
    state.phase,
    maximizingPlayerId,
    state.currentTurnPlayerId ?? "",
    state.trumpSuit ?? "",
    state.callerPlayerId ?? "",
    state.isMus ? 1 : 0,
    cardMaskKey(state.unusedCards),
    state.upcard?.id ?? "",
    trickKey(state.currentTrick),
    state.completedTricks.length,
    state.completedTricks.at(-1)?.winnerPlayerId ?? "",
    state.players.map(playerSearchKey).join(";"),
    handResultKey(state.lastHandResult),
  ].join("|");
}

function playerSearchKey(player: BelotState["players"][number]) {
  return [
    player.playerId,
    cardMaskKey(player.hand),
    cardMaskKey(player.wonCards),
    player.tricksWon,
  ].join(":");
}

function cardMaskKey(cards: Card[] | undefined) {
  let mask = 0;

  for (const card of cards ?? []) {
    const bit = belotCardBitById.get(card.id);

    if (bit !== undefined) {
      mask += bit;
    }
  }

  return mask.toString(36);
}

function trickKey(plays: BelotTrickPlay[]) {
  return plays.map((play) => `${play.playerId}:${play.card.id}`).join(",");
}

function handResultKey(result: BelotState["lastHandResult"]) {
  if (!result) {
    return "";
  }

  return [
    result.callerPlayerId,
    result.opponentPlayerId,
    result.trumpSuit ?? "",
    numberMapKey(result.gamePointsByPlayer),
    numberMapKey(result.declarationPointsByPlayer),
    numberMapKey(result.totalPointsByPlayer),
    numberMapKey(result.handScoreByPlayer),
    result.schusterPlayerIds.slice().sort().join(","),
    result.callerFell ? 1 : 0,
    result.callerFellOnGame ? 1 : 0,
    result.isMus ? 1 : 0,
    result.lastTrickWinnerPlayerId,
  ].join(":");
}

function numberMapKey(pointsByPlayer: Record<string, number>) {
  return Object.entries(pointsByPlayer)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([playerId, points]) => `${playerId}:${points}`)
    .join(",");
}

function shouldUseCheapSearchMove(
  state: BelotState,
  depth: number,
  context: BelotHandPlaySearchContext,
) {
  return (
    remainingSearchPlies(state) > depth && depth <= context.closingSearchPlies
  );
}

function remainingSearchPlies(state: BelotState) {
  if (state.phase !== "trick-play" || !state.currentTurnPlayerId) {
    return 0;
  }

  return state.players.reduce((sum, player) => sum + player.hand.length, 0);
}

function fastForwardDominantTrickLeader(
  state: BelotState,
  maximizingPlayerId: string,
): BelotHandPlaySearchResult | undefined {
  if (
    state.currentTrick.length > 0 ||
    !state.currentTurnPlayerId ||
    !state.trumpSuit ||
    !state.callerPlayerId
  ) {
    return undefined;
  }

  const leader = playerById(state, state.currentTurnPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== leader.playerId,
  );

  if (
    !opponent ||
    leader.hand.length === 0 ||
    leader.hand.length !== opponent.hand.length
  ) {
    return undefined;
  }

  const leaderSuits = new Set(leader.hand.map((card) => card.suit));
  const opponentCanTakeLead = opponent.hand.some(
    (card) => card.suit === state.trumpSuit || leaderSuits.has(card.suit),
  );

  if (opponentCanTakeLead) {
    return undefined;
  }

  const remainingCards = [...leader.hand, ...opponent.hand];
  const remainingTrickCount = leader.hand.length;
  const fastForwardedPlayers = state.players.map((player) =>
    player.playerId === leader.playerId
      ? {
          ...player,
          hand: [],
          wonCards: [...player.wonCards, ...remainingCards],
          tricksWon: player.tricksWon + remainingTrickCount,
        }
      : { ...player, hand: [] },
  );
  const fastForwardedForScoring: BelotState = {
    ...state,
    players: fastForwardedPlayers,
    currentTurnPlayerId: undefined,
    completedTricks: [
      ...state.completedTricks,
      ...Array.from({ length: remainingTrickCount }, () => ({
        winnerPlayerId: leader.playerId,
        cards: [],
      })),
    ],
  };
  const result = calculateBelotHandResult(fastForwardedForScoring);
  const scoredState: BelotState = {
    ...fastForwardedForScoring,
    phase: "hand-complete",
    players: fastForwardedForScoring.players.map((player) => ({
      ...player,
      totalScore:
        player.totalScore + (result.handScoreByPlayer[player.playerId] ?? 0),
    })),
    lastHandResult: result,
    handResults: [...(state.handResults ?? []), result],
  };

  return evaluateSearchLeaf(scoredState, maximizingPlayerId);
}

function evaluateSearchLeaf(
  state: BelotState,
  maximizingPlayerId: string,
): BelotHandPlaySearchResult {
  const result: BelotHandPlaySearchResult = {
    value: evaluateState(state, maximizingPlayerId),
  };

  if (state.callerPlayerId === maximizingPlayerId) {
    result.callerFell = state.lastHandResult?.callerFell;
  }

  if (state.lastHandResult?.schusterPlayerIds.length) {
    result.hasSchuster = true;
  }

  return result;
}

function searchResultBetter(
  candidate: BelotHandPlaySearchResult,
  current: BelotHandPlaySearchResult,
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

function callerAvoidedFall(result: BelotHandPlaySearchResult) {
  return result.callerFell === undefined
    ? result.value >= 0
    : !result.callerFell;
}

function evaluateState(state: BelotState, maximizingPlayerId: string) {
  const maximizingPlayer = playerById(state, maximizingPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== maximizingPlayerId,
  );

  if (!opponent) {
    return 0;
  }

  return maximizingPlayer.totalScore - opponent.totalScore;
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
