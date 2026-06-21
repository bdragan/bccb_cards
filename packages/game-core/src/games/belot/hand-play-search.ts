import type { Card, Suit } from "@card-games/shared";

import {
  applyBelotAction,
  belotCardPoints,
  compareBelotCards,
  legalBelotCards,
} from "./belot";
import type { BelotState, BelotTrickPlay } from "./types";

export const belotHandPlaySearchMaxUtility = 1_000_000;
const maxBelotHandPlayTranspositionEntries = 16_384;
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
};

export type BelotHandPlaySearchContext = {
  closingSearchPlies: number;
  policy: BelotHandPlaySearchPolicy;
  transpositionTable: Map<string, BelotHandPlayTranspositionEntry>;
};

export type BelotHandPlaySearchResult = {
  value: number;
};

export type BelotHandPlayTranspositionBound = "exact" | "lower" | "upper";

export type BelotHandPlayTranspositionEntry = {
  bound: BelotHandPlayTranspositionBound;
  value: number;
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

  const currentPlayer = playerById(state, state.currentTurnPlayerId);
  const legalCards = legalBelotCards(
    currentPlayer.hand,
    state.currentTrick,
    state.trumpSuit,
  );

  if (legalCards.length === 0) {
    return evaluateSearchLeaf(state, maximizingPlayerId);
  }

  const bounds = shouldUseRawPointBounds(state)
    ? rawGamePointDeltaBounds(state, maximizingPlayerId)
    : undefined;

  if (bounds && bounds.upper <= alpha) {
    return { value: alpha };
  }

  if (bounds && bounds.lower >= beta) {
    return { value: beta };
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
        return { value: transpositionEntry.value };
      }

      if (transpositionEntry.bound === "lower") {
        alpha = Math.max(alpha, transpositionEntry.value);
      } else {
        beta = Math.min(beta, transpositionEntry.value);
      }

      if (alpha >= beta) {
        return { value: transpositionEntry.value };
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
      best.value,
      originalAlpha,
      originalBeta,
    );
  }

  return best;
}

function rememberBelotHandPlayTransposition(
  context: BelotHandPlaySearchContext,
  key: string,
  value: number,
  alpha: number,
  beta: number,
) {
  let bound: BelotHandPlayTranspositionBound = "exact";

  if (value <= alpha) {
    bound = "upper";
  } else if (value >= beta) {
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

  context.transpositionTable.set(key, { bound, value });
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

function shouldUseRawPointBounds(state: BelotState) {
  return (
    state.currentTrick.length === 0 &&
    state.players.every((player) => player.hand.length <= 4)
  );
}

function evaluateSearchLeaf(
  state: BelotState,
  maximizingPlayerId: string,
): BelotHandPlaySearchResult {
  return {
    value: evaluateRawGamePointDelta(state, maximizingPlayerId),
  };
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

  return false;
}

function evaluateRawGamePointDelta(
  state: BelotState,
  maximizingPlayerId: string,
) {
  const maximizingPlayer = playerById(state, maximizingPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== maximizingPlayerId,
  );

  if (!opponent || !state.trumpSuit) {
    return 0;
  }

  const gamePointsByPlayer =
    state.lastHandResult?.gamePointsByPlayer ??
    Object.fromEntries(
      state.players.map((player) => [
        player.playerId,
        player.wonCards.reduce(
          (sum, card) => sum + belotCardPoints(card, state.trumpSuit!),
          0,
        ),
      ]),
    );

  return (
    (gamePointsByPlayer[maximizingPlayer.playerId] ?? 0) -
    (gamePointsByPlayer[opponent.playerId] ?? 0)
  );
}

function rawGamePointDeltaBounds(
  state: BelotState,
  maximizingPlayerId: string,
) {
  const maximizingPlayer = playerById(state, maximizingPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== maximizingPlayerId,
  );

  if (!opponent || !state.trumpSuit) {
    return { lower: 0, upper: 0 };
  }

  const trumpSuit = state.trumpSuit;
  let maximizingPlayerPoints = rawWonCardPoints(
    maximizingPlayer.wonCards,
    trumpSuit,
  );
  let opponentPoints = rawWonCardPoints(opponent.wonCards, trumpSuit);
  let remainingPointMass = 10;
  let highestTrump: { card: Card; playerId: string } | undefined;
  let secondHighestTrump: { card: Card; playerId: string } | undefined;

  const addRemainingCard = (card: Card, playerId: string) => {
    remainingPointMass += belotCardPoints(card, trumpSuit);

    if (card.suit !== trumpSuit) {
      return;
    }

    const entry = { card, playerId };

    if (
      !highestTrump ||
      compareBelotCards(card, highestTrump.card, trumpSuit) > 0
    ) {
      secondHighestTrump = highestTrump;
      highestTrump = entry;
      return;
    }

    if (
      !secondHighestTrump ||
      compareBelotCards(card, secondHighestTrump.card, trumpSuit) > 0
    ) {
      secondHighestTrump = entry;
    }
  };

  for (const play of state.currentTrick) {
    addRemainingCard(play.card, play.playerId);
  }

  for (const player of state.players) {
    for (const card of player.hand) {
      addRemainingCard(card, player.playerId);
    }
  }

  if (highestTrump) {
    const highestTrumpPoints = belotCardPoints(highestTrump.card, trumpSuit);

    remainingPointMass -= highestTrumpPoints;
    if (highestTrump.playerId === maximizingPlayerId) {
      maximizingPlayerPoints += highestTrumpPoints;
    } else {
      opponentPoints += highestTrumpPoints;
    }

    if (
      secondHighestTrump &&
      secondHighestTrump.playerId === highestTrump.playerId
    ) {
      const secondHighestTrumpPoints = belotCardPoints(
        secondHighestTrump.card,
        trumpSuit,
      );

      remainingPointMass -= secondHighestTrumpPoints;
      if (secondHighestTrump.playerId === maximizingPlayerId) {
        maximizingPlayerPoints += secondHighestTrumpPoints;
      } else {
        opponentPoints += secondHighestTrumpPoints;
      }
    }
  }

  return {
    lower: maximizingPlayerPoints - (opponentPoints + remainingPointMass),
    upper: maximizingPlayerPoints + remainingPointMass - opponentPoints,
  };
}

function rawWonCardPoints(cards: Card[], trumpSuit: Suit) {
  return cards.reduce((sum, card) => sum + belotCardPoints(card, trumpSuit), 0);
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
