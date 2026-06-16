import type { Card, Suit } from "@card-games/shared";

import {
  applyBelotAction,
  belotCardPoints,
  compareBelotCards,
  legalBelotCards,
} from "./belot";
import type { BelotState } from "./types";

export const belotHandPlaySearchMaxUtility = 1_000_000;

export type BelotHandPlaySearchPolicy = {
  cheapOpeningSearchPlies: number;
  searchCards: (cards: Card[], state: BelotState) => Card[];
  orderCards: (
    cards: Card[],
    state: BelotState,
    maximizing: boolean,
  ) => Card[];
  cheapSearchCard: (cards: Card[], state: BelotState) => Card;
};

export type BelotHandPlaySearchContext = {
  closingSearchPlies: number;
  policy: BelotHandPlaySearchPolicy;
};

export type BelotHandPlaySearchResult = {
  value: number;
};

export function createBelotHandPlaySearchContext(
  depth: number,
  policy: BelotHandPlaySearchPolicy,
): BelotHandPlaySearchContext {
  return {
    closingSearchPlies: Math.max(0, depth - policy.cheapOpeningSearchPlies),
    policy,
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

  return best;
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
  return cards.reduce(
    (sum, card) => sum + belotCardPoints(card, trumpSuit),
    0,
  );
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
