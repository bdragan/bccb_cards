import type { Card, Suit } from "@card-games/shared";

import {
  applyBellotAction,
  bellotCardPoints,
  compareBellotCards,
  legalBellotCards,
} from "./bellot";
import type { BellotState } from "./types";

export const bellotHandPlaySearchMaxUtility = 1_000_000;

export type BellotHandPlaySearchPolicy = {
  cheapOpeningSearchPlies: number;
  searchCards: (cards: Card[], state: BellotState) => Card[];
  orderCards: (
    cards: Card[],
    state: BellotState,
    maximizing: boolean,
  ) => Card[];
  cheapSearchCard: (cards: Card[], state: BellotState) => Card;
};

export type BellotHandPlaySearchContext = {
  closingSearchPlies: number;
  policy: BellotHandPlaySearchPolicy;
};

export type BellotHandPlaySearchResult = {
  value: number;
};

export function createBellotHandPlaySearchContext(
  depth: number,
  policy: BellotHandPlaySearchPolicy,
): BellotHandPlaySearchContext {
  return {
    closingSearchPlies: Math.max(0, depth - policy.cheapOpeningSearchPlies),
    policy,
  };
}

export function bellotHandPlayAlphaBetaValue(
  state: BellotState,
  maximizingPlayerId: string,
  depth: number,
  alpha: number,
  beta: number,
  context: BellotHandPlaySearchContext,
): number {
  return bellotHandPlayAlphaBetaResult(
    state,
    maximizingPlayerId,
    depth,
    alpha,
    beta,
    context,
  ).value;
}

export function bellotHandPlayAlphaBetaResult(
  state: BellotState,
  maximizingPlayerId: string,
  depth: number,
  alpha: number,
  beta: number,
  context: BellotHandPlaySearchContext,
): BellotHandPlaySearchResult {
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
  const legalCards = legalBellotCards(
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
    const next = applyBellotAction(state, {
      type: "play-card",
      playerId: currentPlayer.playerId,
      cardId: card.id,
    });

    return bellotHandPlayAlphaBetaResult(
      next,
      maximizingPlayerId,
      depth,
      alpha,
      beta,
      context,
    );
  }

  const searchCards = context.policy.searchCards(legalCards, state);
  const maximizing = state.currentTurnPlayerId === maximizingPlayerId;
  let best: BellotHandPlaySearchResult = {
    value: maximizing
      ? -bellotHandPlaySearchMaxUtility
      : bellotHandPlaySearchMaxUtility,
  };

  for (const card of context.policy.orderCards(
    searchCards,
    state,
    maximizing,
  )) {
    const next = applyBellotAction(state, {
      type: "play-card",
      playerId: currentPlayer.playerId,
      cardId: card.id,
    });
    const result = bellotHandPlayAlphaBetaResult(
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

  return best;
}

function shouldUseCheapSearchMove(
  state: BellotState,
  depth: number,
  context: BellotHandPlaySearchContext,
) {
  return (
    remainingSearchPlies(state) > depth && depth <= context.closingSearchPlies
  );
}

function remainingSearchPlies(state: BellotState) {
  if (state.phase !== "trick-play" || !state.currentTurnPlayerId) {
    return 0;
  }

  return state.players.reduce((sum, player) => sum + player.hand.length, 0);
}

function shouldUseRawPointBounds(state: BellotState) {
  return (
    state.currentTrick.length === 0 &&
    state.players.every((player) => player.hand.length <= 3)
  );
}

function evaluateSearchLeaf(
  state: BellotState,
  maximizingPlayerId: string,
): BellotHandPlaySearchResult {
  return {
    value: evaluateRawGamePointDelta(state, maximizingPlayerId),
  };
}

function searchResultBetter(
  candidate: BellotHandPlaySearchResult,
  current: BellotHandPlaySearchResult,
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
  state: BellotState,
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
          (sum, card) => sum + bellotCardPoints(card, state.trumpSuit!),
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
  state: BellotState,
  maximizingPlayerId: string,
) {
  const maximizingPlayer = playerById(state, maximizingPlayerId);
  const opponent = state.players.find(
    (player) => player.playerId !== maximizingPlayerId,
  );

  if (!opponent || !state.trumpSuit) {
    return { lower: 0, upper: 0 };
  }

  let maximizingPlayerPoints = rawWonCardPoints(
    maximizingPlayer.wonCards,
    state.trumpSuit,
  );
  let opponentPoints = rawWonCardPoints(opponent.wonCards, state.trumpSuit);
  let remainingPointMass = 10;
  const remainingCards: Array<{ card: Card; playerId: string }> = [];

  for (const play of state.currentTrick) {
    remainingCards.push({ card: play.card, playerId: play.playerId });
  }

  for (const player of state.players) {
    for (const card of player.hand) {
      remainingCards.push({ card, playerId: player.playerId });
    }
  }

  for (const entry of remainingCards) {
    remainingPointMass += bellotCardPoints(entry.card, state.trumpSuit);
  }

  const highestTrump = highestRemainingTrump(remainingCards, state.trumpSuit);

  if (highestTrump) {
    const guaranteedPoints = bellotCardPoints(
      highestTrump.card,
      state.trumpSuit,
    );

    remainingPointMass -= guaranteedPoints;

    if (highestTrump.playerId === maximizingPlayerId) {
      maximizingPlayerPoints += guaranteedPoints;
    } else {
      opponentPoints += guaranteedPoints;
    }
  }

  return {
    lower: maximizingPlayerPoints - (opponentPoints + remainingPointMass),
    upper: maximizingPlayerPoints + remainingPointMass - opponentPoints,
  };
}

function rawWonCardPoints(cards: Card[], trumpSuit: Suit) {
  return cards.reduce(
    (sum, card) => sum + bellotCardPoints(card, trumpSuit),
    0,
  );
}

function highestRemainingTrump(
  cards: Array<{ card: Card; playerId: string }>,
  trumpSuit: Suit,
) {
  let highest: { card: Card; playerId: string } | undefined;

  for (const entry of cards) {
    if (entry.card.suit !== trumpSuit) {
      continue;
    }

    if (
      !highest ||
      compareBellotCards(entry.card, highest.card, trumpSuit) > 0
    ) {
      highest = entry;
    }
  }

  return highest;
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
