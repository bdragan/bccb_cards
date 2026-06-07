import type {
  Card,
  GreaterCardPublicState,
  PlayerRef,
} from "@card-games/shared";

import { createDeck, shuffleDeck } from "../../cards/deck";
import { rankValue } from "../../cards/ranks";
import type { GameDefinition } from "../../engine/types";
import type {
  GreaterCardAction,
  GreaterCardPlayerState,
  GreaterCardState,
} from "./types";

const minPlayers = 2;
const maxPlayers = 8;

function phaseForPlayerCount(playerCount: number): GreaterCardState["phase"] {
  return playerCount >= minPlayers ? "ready-check" : "waiting-for-players";
}

function normalizePlayers(players: PlayerRef[]): GreaterCardPlayerState[] {
  return players.map((player) => ({
    playerId: player.playerId,
    displayName: player.displayName,
    ready: false,
  }));
}

export function createGreaterCardInitialState(
  players: PlayerRef[],
): GreaterCardState {
  return {
    gameId: "greater-card",
    phase: phaseForPlayerCount(players.length),
    deck: [],
    players: normalizePlayers(players),
    winnerPlayerIds: [],
    createdAt: new Date().toISOString(),
  };
}

function ensurePlayer(
  state: GreaterCardState,
  playerId: string,
): GreaterCardPlayerState {
  const player = state.players.find(
    (candidate) => candidate.playerId === playerId,
  );

  if (!player) {
    throw new Error("Player is not in this game");
  }

  return player;
}

function maybeStartDrawing(state: GreaterCardState): GreaterCardState {
  const canStart =
    state.players.length >= minPlayers &&
    state.players.length <= maxPlayers &&
    state.players.every((player) => player.ready);

  if (!canStart) {
    return { ...state, phase: phaseForPlayerCount(state.players.length) };
  }

  return {
    ...state,
    phase: "drawing",
    deck: shuffleDeck(createDeck()),
  };
}

function calculateWinners(players: GreaterCardPlayerState[]): string[] {
  const drawnPlayers = players.filter(
    (player): player is GreaterCardPlayerState & { drawnCard: Card } =>
      Boolean(player.drawnCard),
  );
  const highestRankValue = Math.max(
    ...drawnPlayers.map((player) => rankValue(player.drawnCard.rank)),
  );

  return drawnPlayers
    .filter((player) => rankValue(player.drawnCard.rank) === highestRankValue)
    .map((player) => player.playerId);
}

function applySyncPlayers(
  state: GreaterCardState,
  players: PlayerRef[],
): GreaterCardState {
  const existing = new Map(
    state.players.map((player) => [player.playerId, player]),
  );
  const syncedPlayers = players.map((player) => {
    const current = existing.get(player.playerId);
    return current
      ? { ...current, displayName: player.displayName }
      : { ...player, ready: false };
  });

  return maybeStartDrawing({
    ...state,
    players: syncedPlayers,
    phase: phaseForPlayerCount(syncedPlayers.length),
  });
}

function applyReady(
  state: GreaterCardState,
  playerId: string,
  ready: boolean,
): GreaterCardState {
  if (
    state.phase === "drawing" ||
    state.phase === "revealed" ||
    state.phase === "finished"
  ) {
    throw new Error("Ready status cannot be changed after the game starts");
  }

  ensurePlayer(state, playerId);

  return maybeStartDrawing({
    ...state,
    players: state.players.map((player) =>
      player.playerId === playerId ? { ...player, ready } : player,
    ),
  });
}

function applyDrawCard(
  state: GreaterCardState,
  playerId: string,
): GreaterCardState {
  if (state.phase !== "drawing") {
    throw new Error("Cards can only be drawn during the drawing phase");
  }

  const player = ensurePlayer(state, playerId);

  if (player.drawnCard) {
    throw new Error("Player has already drawn a card");
  }

  const [drawnCard, ...remainingDeck] = state.deck;

  if (!drawnCard) {
    throw new Error("Deck is empty");
  }

  const players = state.players.map((candidate) =>
    candidate.playerId === playerId ? { ...candidate, drawnCard } : candidate,
  );
  const allDrawn = players.every((candidate) => candidate.drawnCard);

  if (!allDrawn) {
    return { ...state, deck: remainingDeck, players };
  }

  return {
    ...state,
    phase: "revealed",
    deck: remainingDeck,
    players,
    winnerPlayerIds: calculateWinners(players),
    finishedAt: new Date().toISOString(),
  };
}

function restart(state: GreaterCardState): GreaterCardState {
  return createGreaterCardInitialState(
    state.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
    })),
  );
}

export function applyGreaterCardAction(
  state: GreaterCardState,
  action: GreaterCardAction,
): GreaterCardState {
  switch (action.type) {
    case "sync-players":
      return applySyncPlayers(state, action.players);
    case "set-ready":
      return applyReady(state, action.playerId, action.ready);
    case "draw-card":
      return applyDrawCard(state, action.playerId);
    case "restart":
      return restart(state);
    default:
      return state;
  }
}

export function getGreaterCardPublicState(
  state: GreaterCardState,
  viewerPlayerId: string,
): GreaterCardPublicState {
  const revealed = state.phase === "revealed" || state.phase === "finished";

  return {
    gameId: "greater-card",
    phase: state.phase,
    players: state.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      ready: player.ready,
      hasDrawn: Boolean(player.drawnCard),
      drawnCard:
        revealed || player.playerId === viewerPlayerId
          ? player.drawnCard
          : undefined,
    })),
    winnerPlayerIds: revealed ? state.winnerPlayerIds : [],
    createdAt: state.createdAt,
    finishedAt: state.finishedAt,
  };
}

export function greaterCardResult(state: GreaterCardState) {
  const tied = state.winnerPlayerIds.length > 1;

  return {
    gameId: "greater-card" as const,
    winnerPlayerIds: state.winnerPlayerIds,
    tied,
    players: state.players.map((player) => {
      const isWinner = state.winnerPlayerIds.includes(player.playerId);
      return {
        playerId: player.playerId,
        displayName: player.displayName,
        card: player.drawnCard,
        outcome:
          tied && isWinner
            ? ("tie" as const)
            : isWinner
              ? ("win" as const)
              : ("loss" as const),
        score: player.drawnCard ? rankValue(player.drawnCard.rank) : undefined,
      };
    }),
  };
}

export const greaterCardDefinition: GameDefinition<
  GreaterCardState,
  GreaterCardAction
> = {
  id: "greater-card",
  displayName: "GreaterCard",
  description: "Each player draws one card. Highest rank wins.",
  minPlayers,
  maxPlayers,
  createInitialState: createGreaterCardInitialState,
  applyAction: applyGreaterCardAction,
  getPublicState: getGreaterCardPublicState,
  isFinished: (state) =>
    state.phase === "revealed" || state.phase === "finished",
};
