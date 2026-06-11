import type {
  BellotDeclaration,
  BellotPublicState,
  BellotResult,
  Card,
  PlayerRef,
  Rank,
  Suit,
} from "@card-games/shared";
import { ranks, suits } from "@card-games/shared";

import { createDeck, shuffleDeck } from "../../cards/deck";
import type { GameDefinition } from "../../engine/types";
import type {
  BellotAction,
  BellotDeclarationCandidate,
  BellotHandResult,
  BellotPlayerState,
  BellotState,
  BellotTrickPlay,
} from "./types";

const minPlayers = 2;
const maxPlayers = 2;
const targetScore = 501;
const sequenceRanks: Rank[] = ["VII", "VIII", "IX", "X", "U", "O", "K", "A"];
const nonTrumpPower: Rank[] = ["VII", "VIII", "IX", "U", "O", "K", "X", "A"];
const trumpPower: Rank[] = ["VII", "VIII", "O", "K", "X", "A", "IX", "U"];
const declarationRankOrder: Rank[] = [
  "VII",
  "VIII",
  "IX",
  "X",
  "U",
  "O",
  "K",
  "A",
];

const declarationTypeStrength = {
  FOUR_JACKS: 8,
  FOUR_NINES: 7,
  SEQUENCE_5_PLUS: 6,
  FOUR_ACES: 5,
  FOUR_TENS: 5,
  FOUR_KINGS: 5,
  FOUR_QUEENS: 5,
  SEQUENCE_4: 4,
  BELOTE: 3,
  SEQUENCE_3: 2,
} as const;

const fourOfKindPoints: Partial<Record<Rank, number>> = {
  U: 200,
  IX: 150,
  A: 100,
  X: 100,
  K: 100,
  O: 100,
};

const fourOfKindTypes: Partial<Record<Rank, BellotDeclaration["type"]>> = {
  U: "FOUR_JACKS",
  IX: "FOUR_NINES",
  A: "FOUR_ACES",
  X: "FOUR_TENS",
  K: "FOUR_KINGS",
  O: "FOUR_QUEENS",
};

function phaseForPlayerCount(playerCount: number): BellotState["phase"] {
  return playerCount === maxPlayers ? "ready-check" : "waiting-for-players";
}

function normalizePlayers(players: PlayerRef[]): BellotPlayerState[] {
  return players.map((player) => ({
    playerId: player.playerId,
    displayName: player.displayName,
    ready: false,
    hand: [],
    hiddenCards: [],
    pickupCardIds: [],
    wonCards: [],
    tricksWon: 0,
    totalScore: 0,
  }));
}

export function createBellotInitialState(players: PlayerRef[]): BellotState {
  return {
    gameId: "bellot",
    phase: phaseForPlayerCount(players.length),
    deck: [],
    unusedCards: [],
    players: normalizePlayers(players),
    isMus: false,
    trumpRound: 0,
    trumpPasses: [],
    currentTrick: [],
    completedTricks: [],
    declarationsByPlayer: {},
    publicCardsByPlayer: {},
    createdAt: new Date().toISOString(),
  };
}

function ensurePlayer(state: BellotState, playerId: string): BellotPlayerState {
  const player = state.players.find(
    (candidate) => candidate.playerId === playerId,
  );

  if (!player) {
    throw new Error("Player is not in this game");
  }

  return player;
}

function opponentOf(state: BellotState, playerId: string) {
  const opponent = state.players.find((player) => player.playerId !== playerId);

  if (!opponent) {
    throw new Error("Opponent is not available");
  }

  return opponent;
}

function nextPlayerId(state: BellotState, playerId: string) {
  return opponentOf(state, playerId).playerId;
}

function firstPlayerForDealer(state: BellotState, dealerPlayerId: string) {
  return nextPlayerId(state, dealerPlayerId);
}

function chooseInitialDealer(players: BellotPlayerState[]) {
  return players[Math.floor(Math.random() * players.length)]?.playerId;
}

function resetHandPlayer(player: BellotPlayerState): BellotPlayerState {
  return {
    ...player,
    ready: true,
    hand: [],
    hiddenCards: [],
    pickupCardIds: [],
    wonCards: [],
    tricksWon: 0,
  };
}

function startHand(
  state: BellotState,
  dealerPlayerId = state.dealerPlayerId ?? chooseInitialDealer(state.players),
): BellotState {
  if (state.players.length !== maxPlayers || !dealerPlayerId) {
    return { ...state, phase: phaseForPlayerCount(state.players.length) };
  }

  const deck = shuffleDeck(createDeck());
  const players = state.players.map(resetHandPlayer);
  const [first, second] = players;

  first.hand = deck.slice(0, 8);
  second.hand = deck.slice(8, 16);
  first.hiddenCards = deck.slice(16, 18);
  second.hiddenCards = deck.slice(18, 20);

  const upcard = deck[20];

  if (!upcard) {
    throw new Error("Deck is incomplete");
  }

  return {
    ...state,
    phase: "trump-round-one",
    deck,
    unusedCards: deck.slice(21),
    players,
    dealerPlayerId,
    firstPlayerId: firstPlayerForDealer({ ...state, players }, dealerPlayerId),
    trumpSuit: undefined,
    callerPlayerId: undefined,
    isMus: false,
    upcard,
    trumpRound: 1,
    trumpTurnPlayerId: firstPlayerForDealer(
      { ...state, players },
      dealerPlayerId,
    ),
    trumpPasses: [],
    currentTurnPlayerId: undefined,
    currentTrick: [],
    completedTricks: [],
    declarationsByPlayer: {},
    publicCardsByPlayer: Object.fromEntries(
      players.map((player) => [player.playerId, []]),
    ),
    lastHandResult: undefined,
    error: undefined,
  };
}

function maybeStartHand(state: BellotState): BellotState {
  const canStart =
    state.players.length === maxPlayers &&
    state.players.every((player) => player.ready);

  return canStart
    ? startHand(state)
    : { ...state, phase: phaseForPlayerCount(state.players.length) };
}

function applySyncPlayers(
  state: BellotState,
  players: PlayerRef[],
): BellotState {
  if (state.phase !== "waiting-for-players" && state.phase !== "ready-check") {
    return state;
  }

  const existing = new Map(
    state.players.map((player) => [player.playerId, player]),
  );
  const syncedPlayers = players.slice(0, maxPlayers).map((player) => {
    const current = existing.get(player.playerId);

    return current
      ? { ...current, displayName: player.displayName }
      : { ...normalizePlayers([player])[0] };
  });

  return maybeStartHand({
    ...state,
    players: syncedPlayers,
    phase: phaseForPlayerCount(syncedPlayers.length),
  });
}

function applyReady(
  state: BellotState,
  playerId: string,
  ready: boolean,
): BellotState {
  if (state.phase !== "waiting-for-players" && state.phase !== "ready-check") {
    throw new Error("Ready status cannot be changed after the game starts");
  }

  ensurePlayer(state, playerId);

  return maybeStartHand({
    ...state,
    players: state.players.map((player) =>
      player.playerId === playerId ? { ...player, ready } : player,
    ),
  });
}

function finishTrumpSelection(
  state: BellotState,
  playerId: string,
  suit: Suit,
  isMus: boolean,
): BellotState {
  const players = state.players.map((player) => ({
    ...player,
    hand: [...player.hand, ...player.hiddenCards],
    pickupCardIds: player.hiddenCards.map((card) => card.id),
    hiddenCards: [],
  }));

  return {
    ...state,
    phase: "declarations",
    players,
    trumpSuit: suit,
    callerPlayerId: playerId,
    isMus,
    trumpTurnPlayerId: undefined,
    currentTurnPlayerId: undefined,
  };
}

function ensureTrumpTurn(state: BellotState, playerId: string) {
  ensurePlayer(state, playerId);

  if (state.trumpTurnPlayerId !== playerId) {
    throw new Error("It is not this player's trump decision turn");
  }
}

function applyTrumpPass(state: BellotState, playerId: string): BellotState {
  ensureTrumpTurn(state, playerId);

  if (state.phase !== "trump-round-one" && state.phase !== "trump-round-two") {
    throw new Error("Passing is only allowed during trump selection");
  }

  const trumpPasses = [...state.trumpPasses, playerId];

  if (state.phase === "trump-round-one" && trumpPasses.length === 1) {
    return {
      ...state,
      trumpPasses,
      trumpTurnPlayerId: nextPlayerId(state, playerId),
    };
  }

  if (state.phase === "trump-round-one") {
    return {
      ...state,
      phase: "trump-round-two",
      trumpRound: 2,
      trumpPasses: [],
      trumpTurnPlayerId: state.firstPlayerId,
    };
  }

  if (trumpPasses.length === 1) {
    return {
      ...state,
      trumpPasses,
      trumpTurnPlayerId: nextPlayerId(state, playerId),
    };
  }

  return {
    ...state,
    phase: "mus",
    trumpRound: 3,
    trumpPasses: [],
    trumpTurnPlayerId: state.firstPlayerId,
    isMus: true,
  };
}

function applyTrumpAcceptUpcard(
  state: BellotState,
  playerId: string,
): BellotState {
  ensureTrumpTurn(state, playerId);

  if (state.phase !== "trump-round-one" || !state.upcard) {
    throw new Error("The upcard can only be accepted in the first round");
  }

  return finishTrumpSelection(state, playerId, state.upcard.suit, false);
}

function applyTrumpChooseSuit(
  state: BellotState,
  playerId: string,
  suit: Suit,
): BellotState {
  ensureTrumpTurn(state, playerId);

  if (state.phase !== "trump-round-two" && state.phase !== "mus") {
    throw new Error("A suit can only be chosen in the second round or on mus");
  }

  if (state.upcard?.suit === suit) {
    throw new Error("The upcard suit cannot be chosen in this round");
  }

  return finishTrumpSelection(state, playerId, suit, state.phase === "mus");
}

function cardKey(card: Card) {
  return card.id;
}

function rankIndex(rank: Rank) {
  return sequenceRanks.indexOf(rank);
}

function sortCardsDeterministically(cards: Card[]) {
  return [...cards].sort((left, right) => {
    const suitDelta = suits.indexOf(left.suit) - suits.indexOf(right.suit);

    if (suitDelta !== 0) {
      return suitDelta;
    }

    return (
      declarationRankOrder.indexOf(left.rank) -
      declarationRankOrder.indexOf(right.rank)
    );
  });
}

function sequencePoints(length: number) {
  if (length === 3) {
    return 20;
  }

  if (length === 4) {
    return 50;
  }

  return 100;
}

function sequenceType(length: number): BellotDeclaration["type"] {
  if (length === 3) {
    return "SEQUENCE_3";
  }

  if (length === 4) {
    return "SEQUENCE_4";
  }

  return "SEQUENCE_5_PLUS";
}

function declarationPublicCardCount(
  declarations: BellotDeclarationCandidate[],
) {
  return new Set(
    declarations.flatMap((declaration) => declaration.cards.map(cardKey)),
  ).size;
}

function declarationStrength(
  declaration: Pick<BellotDeclaration, "type" | "points">,
) {
  return declaration.points * 10 + declarationTypeStrength[declaration.type];
}

function deterministicDeclarationOrder(
  left: BellotDeclarationCandidate,
  right: BellotDeclarationCandidate,
) {
  const pointDelta = right.points - left.points;

  if (pointDelta !== 0) {
    return pointDelta;
  }

  const typeDelta =
    declarationTypeStrength[right.type] - declarationTypeStrength[left.type];

  if (typeDelta !== 0) {
    return typeDelta;
  }

  const leftFirst = sortCardsDeterministically(left.cards)[0];
  const rightFirst = sortCardsDeterministically(right.cards)[0];

  if (!leftFirst || !rightFirst) {
    return 0;
  }

  const suitDelta =
    suits.indexOf(leftFirst.suit) - suits.indexOf(rightFirst.suit);

  if (suitDelta !== 0) {
    return suitDelta;
  }

  return rankIndex(leftFirst.rank) - rankIndex(rightFirst.rank);
}

export function generateBellotDeclarationCandidates(
  hand: Card[],
  trumpSuit: Suit,
): BellotDeclarationCandidate[] {
  const candidates: BellotDeclarationCandidate[] = [];

  for (const suit of suits) {
    const suitCards = sequenceRanks
      .map((rank) =>
        hand.find((card) => card.suit === suit && card.rank === rank),
      )
      .map((card, index) => ({ card, index }))
      .filter((entry): entry is { card: Card; index: number } =>
        Boolean(entry.card),
      );

    let run: Card[] = [];
    let previousIndex = -2;

    for (const entry of suitCards) {
      if (entry.index === previousIndex + 1) {
        run.push(entry.card);
      } else {
        addSequenceCandidates(candidates, run);
        run = [entry.card];
      }

      previousIndex = entry.index;
    }

    addSequenceCandidates(candidates, run);
  }

  for (const rank of ranks) {
    const cards = suits
      .map((suit) =>
        hand.find((card) => card.suit === suit && card.rank === rank),
      )
      .filter((card): card is Card => Boolean(card));
    const points = fourOfKindPoints[rank];
    const type = fourOfKindTypes[rank];

    if (cards.length === 4 && points && type) {
      candidates.push({
        type,
        cards: sortCardsDeterministically(cards),
        points,
      });
    }
  }

  const beloteCards = [
    hand.find((card) => card.suit === trumpSuit && card.rank === "O"),
    hand.find((card) => card.suit === trumpSuit && card.rank === "K"),
  ].filter((card): card is Card => Boolean(card));

  if (beloteCards.length === 2) {
    candidates.push({
      type: "BELOTE",
      cards: sortCardsDeterministically(beloteCards),
      points: 20,
    });
  }

  return candidates.sort(deterministicDeclarationOrder);
}

function addSequenceCandidates(
  candidates: BellotDeclarationCandidate[],
  run: Card[],
) {
  if (run.length < 3) {
    return;
  }

  for (let start = 0; start <= run.length - 3; start += 1) {
    for (let end = start + 3; end <= run.length; end += 1) {
      const cards = sortCardsDeterministically(run.slice(start, end));
      candidates.push({
        type: sequenceType(cards.length),
        cards,
        points: sequencePoints(cards.length),
      });
    }
  }
}

function canCombineDeclarations(declarations: BellotDeclarationCandidate[]) {
  const ordinaryCards = new Set<string>();

  for (const declaration of declarations) {
    if (declaration.type === "BELOTE") {
      continue;
    }

    for (const card of declaration.cards) {
      const key = cardKey(card);

      if (ordinaryCards.has(key)) {
        return false;
      }

      ordinaryCards.add(key);
    }
  }

  return (
    declarations.filter((declaration) => declaration.type === "BELOTE")
      .length <= 1
  );
}

function declarationSetBetter(
  candidate: BellotDeclarationCandidate[],
  current: BellotDeclarationCandidate[],
) {
  const candidatePoints = sumDeclarationPoints(candidate);
  const currentPoints = sumDeclarationPoints(current);

  if (candidatePoints !== currentPoints) {
    return candidatePoints > currentPoints;
  }

  const candidatePublicCards = declarationPublicCardCount(candidate);
  const currentPublicCards = declarationPublicCardCount(current);

  if (candidatePublicCards !== currentPublicCards) {
    return candidatePublicCards < currentPublicCards;
  }

  const candidateStrongest = Math.max(
    0,
    ...candidate.map((declaration) => declarationStrength(declaration)),
  );
  const currentStrongest = Math.max(
    0,
    ...current.map((declaration) => declarationStrength(declaration)),
  );

  if (candidateStrongest !== currentStrongest) {
    return candidateStrongest > currentStrongest;
  }

  const candidateSignature = candidate
    .slice()
    .sort(deterministicDeclarationOrder)
    .map(
      (declaration) =>
        `${declaration.type}:${declaration.cards.map(cardKey).join(",")}`,
    )
    .join("|");
  const currentSignature = current
    .slice()
    .sort(deterministicDeclarationOrder)
    .map(
      (declaration) =>
        `${declaration.type}:${declaration.cards.map(cardKey).join(",")}`,
    )
    .join("|");

  return candidateSignature < currentSignature;
}

export function autoSelectBellotDeclarations(
  hand: Card[],
  trumpSuit: Suit,
): BellotDeclaration[] {
  const candidates = generateBellotDeclarationCandidates(hand, trumpSuit);
  let best: BellotDeclarationCandidate[] = [];

  function visit(index: number, selected: BellotDeclarationCandidate[]) {
    if (index >= candidates.length) {
      if (
        canCombineDeclarations(selected) &&
        declarationSetBetter(selected, best)
      ) {
        best = selected;
      }

      return;
    }

    visit(index + 1, selected);
    const next = [...selected, candidates[index]];

    if (canCombineDeclarations(next)) {
      visit(index + 1, next);
    }
  }

  visit(0, []);

  return best
    .slice()
    .sort(deterministicDeclarationOrder)
    .map((declaration) => ({
      type: declaration.type,
      cards: declaration.cards,
      points: declaration.points,
    }));
}

function sumDeclarationPoints(
  declarations: Array<Pick<BellotDeclaration, "points">>,
) {
  return declarations.reduce((sum, declaration) => sum + declaration.points, 0);
}

function validateDeclarationShape(
  declaration: BellotDeclaration,
  trumpSuit: Suit,
) {
  const cards = sortCardsDeterministically(declaration.cards);
  const uniqueIds = new Set(cards.map(cardKey));

  if (uniqueIds.size !== cards.length) {
    throw new Error("Declaration contains duplicate cards");
  }

  if (declaration.type === "BELOTE") {
    const valid =
      declaration.points === 20 &&
      cards.length === 2 &&
      cards.every((card) => card.suit === trumpSuit) &&
      cards.some((card) => card.rank === "K") &&
      cards.some((card) => card.rank === "O");

    if (!valid) {
      throw new Error("Invalid belote declaration");
    }

    return;
  }

  if (declaration.type.startsWith("SEQUENCE_")) {
    const suit = cards[0]?.suit;
    const indices = cards
      .map((card) => rankIndex(card.rank))
      .sort((left, right) => left - right);
    const length = cards.length;
    const valid =
      Boolean(suit) &&
      cards.every((card) => card.suit === suit) &&
      length >= 3 &&
      declaration.type === sequenceType(length) &&
      declaration.points === sequencePoints(length) &&
      indices.every((index, position) =>
        position === 0 ? true : index === indices[position - 1] + 1,
      );

    if (!valid) {
      throw new Error("Invalid sequence declaration");
    }

    return;
  }

  const rank = cards[0]?.rank;
  const points = rank ? fourOfKindPoints[rank] : undefined;
  const type = rank ? fourOfKindTypes[rank] : undefined;
  const valid =
    cards.length === 4 &&
    Boolean(rank) &&
    cards.every((card) => card.rank === rank) &&
    new Set(cards.map((card) => card.suit)).size === 4 &&
    declaration.type === type &&
    declaration.points === points;

  if (!valid) {
    throw new Error("Invalid four-of-kind declaration");
  }
}

export function validateBellotDeclarations(input: {
  hand: Card[];
  trumpSuit: Suit;
  declarations: BellotDeclaration[];
}) {
  const handById = new Map(input.hand.map((card) => [card.id, card]));
  const ordinaryCards = new Set<string>();
  let beloteCount = 0;

  for (const declaration of input.declarations) {
    validateDeclarationShape(declaration, input.trumpSuit);

    for (const card of declaration.cards) {
      const actualCard = handById.get(card.id);

      if (!actualCard) {
        throw new Error("Declaration uses a card outside the player's hand");
      }

      if (actualCard.rank !== card.rank || actualCard.suit !== card.suit) {
        throw new Error("Declaration card does not match the player's hand");
      }
    }

    if (declaration.type === "BELOTE") {
      beloteCount += 1;
      continue;
    }

    for (const card of declaration.cards) {
      if (ordinaryCards.has(card.id)) {
        throw new Error("Declaration cards overlap illegally");
      }

      ordinaryCards.add(card.id);
    }
  }

  if (beloteCount > 1) {
    throw new Error("Belote can only be declared once");
  }
}

function applyDeclare(
  state: BellotState,
  playerId: string,
  declarations: BellotDeclaration[],
): BellotState {
  const player = ensurePlayer(state, playerId);

  if (
    Object.prototype.hasOwnProperty.call(state.declarationsByPlayer, playerId)
  ) {
    return state;
  }

  if (state.phase !== "declarations" || !state.trumpSuit) {
    throw new Error("Declarations are not currently open");
  }

  validateBellotDeclarations({
    hand: player.hand,
    trumpSuit: state.trumpSuit,
    declarations,
  });

  const declarationsByPlayer = {
    ...state.declarationsByPlayer,
    [playerId]: declarations,
  };
  const publicCardsByPlayer = {
    ...state.publicCardsByPlayer,
    [playerId]: uniqueCards(
      declarations.flatMap((declaration) => declaration.cards),
    ),
  };
  const allSubmitted = state.players.every((candidate) =>
    Object.prototype.hasOwnProperty.call(
      declarationsByPlayer,
      candidate.playerId,
    ),
  );

  if (!allSubmitted) {
    return { ...state, declarationsByPlayer, publicCardsByPlayer };
  }

  return {
    ...state,
    phase: "trick-play",
    declarationsByPlayer,
    publicCardsByPlayer,
    currentTurnPlayerId: state.firstPlayerId,
  };
}

function uniqueCards(cards: Card[]) {
  const byId = new Map(cards.map((card) => [card.id, card]));

  return [...byId.values()].sort((left, right) =>
    cardKey(left).localeCompare(cardKey(right)),
  );
}

export function bellotCardPoints(card: Card, trumpSuit: Suit) {
  if (card.suit === trumpSuit) {
    return (
      {
        U: 20,
        IX: 14,
        A: 11,
        X: 10,
        K: 4,
        O: 3,
        VIII: 0,
        VII: 0,
      } satisfies Record<Rank, number>
    )[card.rank];
  }

  return (
    {
      A: 11,
      X: 10,
      K: 4,
      O: 3,
      U: 2,
      IX: 0,
      VIII: 0,
      VII: 0,
    } satisfies Record<Rank, number>
  )[card.rank];
}

function currentGamePointsForPlayer(
  state: BellotState,
  player: BellotPlayerState,
) {
  if (state.lastHandResult) {
    return state.lastHandResult.gamePointsByPlayer[player.playerId] ?? 0;
  }

  if (!state.trumpSuit) {
    return 0;
  }

  return player.wonCards.reduce(
    (sum, card) => sum + bellotCardPoints(card, state.trumpSuit!),
    0,
  );
}

function cardPower(card: Card, trumpSuit: Suit) {
  return (card.suit === trumpSuit ? trumpPower : nonTrumpPower).indexOf(
    card.rank,
  );
}

export function compareBellotCards(left: Card, right: Card, trumpSuit: Suit) {
  if (left.suit !== right.suit) {
    throw new Error("Cannot directly compare different suits");
  }

  return cardPower(left, trumpSuit) - cardPower(right, trumpSuit);
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

export function legalBellotCards(
  hand: Card[],
  currentTrick: BellotTrickPlay[],
  trumpSuit: Suit,
): Card[] {
  if (currentTrick.length === 0) {
    return hand;
  }

  const leadSuit = currentTrick[0].card.suit;
  const followSuit = hand.filter((card) => card.suit === leadSuit);

  if (followSuit.length > 0) {
    return followSuit;
  }

  const trumps = hand.filter((card) => card.suit === trumpSuit);

  return trumps.length ? trumps : hand;
}

function applyPlayCard(
  state: BellotState,
  playerId: string,
  cardId: string,
): BellotState {
  if (state.phase !== "trick-play" || !state.trumpSuit) {
    throw new Error("Cards can only be played during trick play");
  }

  if (state.currentTurnPlayerId !== playerId) {
    throw new Error("It is not this player's turn");
  }

  const player = ensurePlayer(state, playerId);
  const card = player.hand.find((candidate) => candidate.id === cardId);

  if (!card) {
    throw new Error("Card is not in the player's hand");
  }

  const legalCards = legalBellotCards(
    player.hand,
    state.currentTrick,
    state.trumpSuit,
  );

  if (!legalCards.some((candidate) => candidate.id === cardId)) {
    throw new Error("Card play is not legal");
  }

  const players = state.players.map((candidate) =>
    candidate.playerId === playerId
      ? {
          ...candidate,
          hand: candidate.hand.filter((handCard) => handCard.id !== cardId),
        }
      : candidate,
  );
  const currentTrick = [...state.currentTrick, { playerId, card }];

  if (currentTrick.length < state.players.length) {
    return {
      ...state,
      players,
      currentTrick,
      currentTurnPlayerId: nextPlayerId(state, playerId),
    };
  }

  const winner = trickWinner(currentTrick, state.trumpSuit);
  const wonCards = currentTrick.map((play) => play.card);
  const playersWithTrick = players.map((candidate) =>
    candidate.playerId === winner.playerId
      ? {
          ...candidate,
          wonCards: [...candidate.wonCards, ...wonCards],
          tricksWon: candidate.tricksWon + 1,
        }
      : candidate,
  );
  const completedTricks = [
    ...state.completedTricks,
    { winnerPlayerId: winner.playerId, cards: currentTrick },
  ];
  const handComplete = completedTricks.length === 10;

  if (!handComplete) {
    return {
      ...state,
      players: playersWithTrick,
      currentTrick: [],
      completedTricks,
      currentTurnPlayerId: winner.playerId,
    };
  }

  return completeHand({
    ...state,
    players: playersWithTrick,
    currentTrick: [],
    completedTricks,
    currentTurnPlayerId: undefined,
  });
}

function completeHand(state: BellotState): BellotState {
  if (!state.trumpSuit || !state.callerPlayerId) {
    throw new Error("Cannot score a hand before trump is selected");
  }

  const result = calculateBellotHandResult(state);
  const players = state.players.map((player) => ({
    ...player,
    totalScore: player.totalScore + result.handScoreByPlayer[player.playerId],
  }));
  const winnerPlayerId = calculateGameWinner(players);
  const finished = Boolean(winnerPlayerId);

  return {
    ...state,
    phase: finished ? "finished" : "hand-complete",
    players,
    lastHandResult: result,
    winnerPlayerId,
    finishedAt: finished ? new Date().toISOString() : state.finishedAt,
  };
}

export function calculateBellotHandResult(
  state: BellotState,
): BellotHandResult {
  if (!state.trumpSuit || !state.callerPlayerId) {
    throw new Error("Cannot score without trump and caller");
  }

  const lastTrickWinnerPlayerId = state.completedTricks.at(-1)?.winnerPlayerId;

  if (!lastTrickWinnerPlayerId) {
    throw new Error("Cannot score before a trick has been won");
  }

  const gamePointsByPlayer = Object.fromEntries(
    state.players.map((player) => [
      player.playerId,
      player.wonCards.reduce(
        (sum, card) => sum + bellotCardPoints(card, state.trumpSuit!),
        player.playerId === lastTrickWinnerPlayerId ? 10 : 0,
      ),
    ]),
  );
  const declarationPointsByPlayer = Object.fromEntries(
    state.players.map((player) => [
      player.playerId,
      sumDeclarationPoints(state.declarationsByPlayer[player.playerId] ?? []),
    ]),
  );
  const totalPointsByPlayer = Object.fromEntries(
    state.players.map((player) => [
      player.playerId,
      gamePointsByPlayer[player.playerId] +
        declarationPointsByPlayer[player.playerId],
    ]),
  );
  const opponent = opponentOf(state, state.callerPlayerId);
  const schusterPlayerIds = state.players
    .filter((player) => player.tricksWon === 0)
    .map((player) => player.playerId);
  const scoringDeclarationPointsByPlayer = { ...declarationPointsByPlayer };

  for (const playerId of schusterPlayerIds) {
    const schusterDeclarationPoints =
      scoringDeclarationPointsByPlayer[playerId] ?? 0;
    const winner = opponentOf(state, playerId);

    scoringDeclarationPointsByPlayer[playerId] = 0;
    scoringDeclarationPointsByPlayer[winner.playerId] +=
      schusterDeclarationPoints;
  }

  const scoringTotalPointsByPlayer = Object.fromEntries(
    state.players.map((player) => [
      player.playerId,
      gamePointsByPlayer[player.playerId] +
        scoringDeclarationPointsByPlayer[player.playerId],
    ]),
  );
  const callerGame = gamePointsByPlayer[state.callerPlayerId];
  const opponentGame = gamePointsByPlayer[opponent.playerId];
  const callerTotal = scoringTotalPointsByPlayer[state.callerPlayerId];
  const opponentTotal = scoringTotalPointsByPlayer[opponent.playerId];
  const callerFell = callerTotal <= opponentTotal;
  const callerFellOnGame = callerGame <= opponentGame;
  const handScoreByPlayer = Object.fromEntries(
    state.players.map((player) => [player.playerId, 0]),
  );

  if (!callerFell) {
    handScoreByPlayer[state.callerPlayerId] = callerTotal;
    handScoreByPlayer[opponent.playerId] = opponentTotal;
  } else if (!callerFellOnGame) {
    handScoreByPlayer[state.callerPlayerId] = 0;
    handScoreByPlayer[opponent.playerId] = opponentTotal;
  } else if (state.isMus) {
    handScoreByPlayer[state.callerPlayerId] = -20;
    handScoreByPlayer[opponent.playerId] = opponentTotal;
  } else {
    handScoreByPlayer[state.callerPlayerId] = 0;
    handScoreByPlayer[opponent.playerId] = opponentTotal + callerTotal;
  }

  for (const playerId of schusterPlayerIds) {
    handScoreByPlayer[playerId] -= 100;
  }

  return {
    callerPlayerId: state.callerPlayerId,
    opponentPlayerId: opponent.playerId,
    gamePointsByPlayer,
    declarationPointsByPlayer,
    totalPointsByPlayer,
    handScoreByPlayer,
    schusterPlayerIds,
    callerFell,
    callerFellOnGame,
    isMus: state.isMus,
    lastTrickWinnerPlayerId,
  };
}

function calculateGameWinner(players: BellotPlayerState[]) {
  const reached = players.filter((player) => player.totalScore >= targetScore);

  if (reached.length === 0) {
    return undefined;
  }

  if (reached.length === 1) {
    return reached[0].playerId;
  }

  if (reached[0].totalScore === reached[1].totalScore) {
    return undefined;
  }

  return reached[0].totalScore > reached[1].totalScore
    ? reached[0].playerId
    : reached[1].playerId;
}

function applyNextHand(state: BellotState): BellotState {
  if (state.phase !== "hand-complete") {
    throw new Error("The next hand can only start after a completed hand");
  }

  const nextDealer = state.dealerPlayerId
    ? nextPlayerId(state, state.dealerPlayerId)
    : chooseInitialDealer(state.players);

  return startHand({ ...state, dealerPlayerId: nextDealer }, nextDealer);
}

function restart(state: BellotState): BellotState {
  return createBellotInitialState(
    state.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
    })),
  );
}

export function applyBellotAction(
  state: BellotState,
  action: BellotAction,
): BellotState {
  try {
    switch (action.type) {
      case "sync-players":
        return applySyncPlayers(state, action.players);
      case "set-ready":
        return applyReady(state, action.playerId, action.ready);
      case "trump-pass":
        return applyTrumpPass(state, action.playerId);
      case "trump-accept-upcard":
        return applyTrumpAcceptUpcard(state, action.playerId);
      case "trump-choose-suit":
        return applyTrumpChooseSuit(state, action.playerId, action.suit);
      case "declare":
        return applyDeclare(state, action.playerId, action.declarations);
      case "play-card":
        return applyPlayCard(state, action.playerId, action.cardId);
      case "next-hand":
        return applyNextHand(state);
      case "restart":
        return restart(state);
      default:
        return state;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Bellot action failed";

    if (action.type === "declare") {
      return { ...state, phase: "error", error: message };
    }

    throw error;
  }
}

export function getBellotPublicState(
  state: BellotState,
  viewerPlayerId: string,
): BellotPublicState {
  const viewerHasPlayedCard =
    state.currentTrick.some((play) => play.playerId === viewerPlayerId) ||
    state.completedTricks.some((trick) =>
      trick.cards.some((play) => play.playerId === viewerPlayerId),
    );

  const revealHandResultCards = Boolean(state.lastHandResult);

  return {
    gameId: "bellot",
    phase: state.phase,
    players: state.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      ready: player.ready,
      hand: player.playerId === viewerPlayerId ? player.hand : undefined,
      pickupCardIds:
        revealHandResultCards ||
        (player.playerId === viewerPlayerId &&
          player.hiddenCards.length === 0 &&
          !viewerHasPlayedCard)
          ? (player.pickupCardIds ?? [])
          : undefined,
      handCount: player.hand.length,
      publicCards: state.publicCardsByPlayer[player.playerId] ?? [],
      declarationsSubmitted: Object.prototype.hasOwnProperty.call(
        state.declarationsByPlayer,
        player.playerId,
      ),
      totalScore: player.totalScore,
      handScore: state.lastHandResult?.handScoreByPlayer[player.playerId] ?? 0,
      gamePoints: currentGamePointsForPlayer(state, player),
      tricksWon: player.tricksWon,
    })),
    dealerPlayerId: state.dealerPlayerId,
    firstPlayerId: state.firstPlayerId,
    trumpSuit: state.trumpSuit,
    callerPlayerId: state.callerPlayerId,
    isMus: state.isMus,
    upcard: state.upcard,
    trumpTurnPlayerId: state.trumpTurnPlayerId,
    trumpPasses: state.trumpPasses,
    currentTurnPlayerId: state.currentTurnPlayerId,
    currentTrick: state.currentTrick,
    completedTricks: state.completedTricks,
    declarationsByPlayer: state.declarationsByPlayer,
    publicCardsByPlayer: state.publicCardsByPlayer,
    unusedCards: revealHandResultCards ? state.unusedCards : undefined,
    lastHandResult: state.lastHandResult,
    winnerPlayerId: state.winnerPlayerId,
    createdAt: state.createdAt,
    finishedAt: state.finishedAt,
    error: state.error,
  };
}

export function bellotResult(state: BellotState): Omit<BellotResult, "roomId"> {
  const highScore = Math.max(
    ...state.players.map((player) => player.totalScore),
  );
  const winnerPlayerIds = state.winnerPlayerId ? [state.winnerPlayerId] : [];
  const tied = winnerPlayerIds.length === 0 && highScore >= targetScore;

  return {
    gameId: "bellot",
    winnerPlayerIds,
    tied,
    players: state.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      outcome:
        tied && player.totalScore === highScore
          ? "tie"
          : winnerPlayerIds.includes(player.playerId)
            ? "win"
            : "loss",
      score: player.totalScore,
    })),
  };
}

export const bellotDefinition: GameDefinition<BellotState, BellotAction> = {
  id: "bellot",
  displayName: "Bellot",
  description:
    "Two-player Belot with hidden pickup cards, client-submitted declarations, mus, fall scoring, and schuster penalties.",
  minPlayers,
  maxPlayers,
  createInitialState: createBellotInitialState,
  applyAction: applyBellotAction,
  getPublicState: getBellotPublicState,
  isFinished: (state) => state.phase === "finished",
};
