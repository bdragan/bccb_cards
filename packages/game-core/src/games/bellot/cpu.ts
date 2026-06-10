import type { Card, Suit } from "@card-games/shared";
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
  trumpAcceptThreshold?: number;
  trumpChooseThreshold?: number;
};

const defaultMaxSearchPlies = 6;
const defaultMonteCarloSamples = 10;
const maxUtility = 1_000_000;

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
  if (state.phase === "trump-round-one" && state.upcard) {
    const score = scoreTrumpSuit(player.hand, state.upcard.suit);
    const threshold = options.trumpAcceptThreshold ?? 58;

    return score >= threshold
      ? { type: "trump-accept-upcard", playerId: player.playerId }
      : { type: "trump-pass", playerId: player.playerId };
  }

  if (
    (state.phase === "trump-round-two" || state.phase === "mus") &&
    state.upcard
  ) {
    const [bestSuit, bestScore] = bestTrumpSuit(player.hand, state.upcard.suit);
    const threshold = options.trumpChooseThreshold ?? 68;

    if (state.phase === "mus" || bestScore >= threshold) {
      return {
        type: "trump-choose-suit",
        playerId: player.playerId,
        suit: bestSuit,
      };
    }

    return { type: "trump-pass", playerId: player.playerId };
  }

  return undefined;
}

function bestTrumpSuit(hand: Card[], excludedSuit: Suit): [Suit, number] {
  const candidates = suits
    .filter((suit) => suit !== excludedSuit)
    .map((suit) => [suit, scoreTrumpSuit(hand, suit)] as [Suit, number])
    .sort((left, right) => right[1] - left[1]);

  const best = candidates[0];

  if (!best) {
    throw new Error("No selectable trump suit is available");
  }

  return best;
}

function scoreTrumpSuit(hand: Card[], trumpSuit: Suit) {
  const trumpCards = hand.filter((card) => card.suit === trumpSuit);
  const offSuitAces = hand.filter(
    (card) => card.suit !== trumpSuit && card.rank === "A",
  ).length;
  const offSuitTens = hand.filter(
    (card) => card.suit !== trumpSuit && card.rank === "X",
  ).length;
  const declarationPoints = autoSelectBellotDeclarations(
    hand,
    trumpSuit,
  ).reduce((sum, declaration) => sum + declaration.points, 0);

  return (
    trumpCards.reduce(
      (sum, card) => sum + bellotCardPoints(card, trumpSuit) * 1.35,
      0,
    ) +
    trumpCards.length * 5 +
    (trumpCards.some((card) => card.rank === "U") ? 24 : 0) +
    (trumpCards.some((card) => card.rank === "IX") ? 14 : 0) +
    offSuitAces * 9 +
    offSuitTens * 4 +
    declarationPoints * 0.35
  );
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
    options.monteCarloSamples ?? defaultMonteCarloSamples,
    rng,
  );
  const scores = new Map(legalCards.map((card) => [card.id, 0]));

  for (const sample of samples) {
    for (const card of orderCardsForSearch(legalCards, sample, cpuPlayerId)) {
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
      );

      scores.set(card.id, (scores.get(card.id) ?? 0) + value);
    }
  }

  return legalCards.slice().sort((left, right) => {
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
): number {
  if (
    depth <= 0 ||
    state.phase === "hand-complete" ||
    state.phase === "finished"
  ) {
    return evaluateState(state, cpuPlayerId);
  }

  if (
    state.phase !== "trick-play" ||
    !state.trumpSuit ||
    !state.currentTurnPlayerId
  ) {
    return evaluateState(state, cpuPlayerId);
  }

  const currentPlayer = playerById(state, state.currentTurnPlayerId);
  const legalCards = legalBellotCards(
    currentPlayer.hand,
    state.currentTrick,
    state.trumpSuit,
  );

  if (legalCards.length === 0) {
    return evaluateState(state, cpuPlayerId);
  }

  const maximizing = state.currentTurnPlayerId === cpuPlayerId;
  let best = maximizing ? -maxUtility : maxUtility;

  for (const card of orderCardsForSearch(
    legalCards,
    state,
    currentPlayer.playerId,
  )) {
    const next = applyBellotAction(state, {
      type: "play-card",
      playerId: currentPlayer.playerId,
      cardId: card.id,
    });
    const value = alphaBeta(next, cpuPlayerId, depth - 1, alpha, beta);

    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, value);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, value);
    }

    if (beta <= alpha) {
      break;
    }
  }

  return best;
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
  const count = unknownNeeded > 0 ? Math.max(1, sampleCount) : 1;

  return Array.from({ length: count }, () => {
    const sampledUnknownCards = shuffleDeck(unknownPool, rng).slice(
      0,
      unknownNeeded,
    );
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
