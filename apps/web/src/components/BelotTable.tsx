import {
  autoSelectBelotDeclarations,
  belotCardPoints,
  compareBelotCards,
  legalBelotCards,
} from "@card-games/game-core";
import type {
  BelotDeclaration,
  BelotHandResult,
  BelotPublicState,
  BelotTrickPlay,
  Card,
  Rank,
  Suit,
} from "@card-games/shared";
import type { ReactNode } from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { suitImagePaths } from "../game/card-assets";
import { PlayingCard } from "../game/cards";
import { type Messages, useI18n } from "../i18n";
import { Button } from "./Button";

const suitOrder: Suit[] = ["acorns", "bells", "hearts", "leaves"];
const rankOrder: Rank[] = ["VII", "VIII", "IX", "X", "U", "O", "K", "A"];
const configuredCompletedTrickLingerMs = Number(
  import.meta.env.VITE_BELOT_RESULT_DELAY_MS,
);
const completedTrickLingerMs = Number.isFinite(configuredCompletedTrickLingerMs)
  ? Math.max(0, configuredCompletedTrickLingerMs)
  : 1_500;
const completedTrickCollectMs =
  completedTrickLingerMs > 0 ? Math.min(500, completedTrickLingerMs) : 0;
const completedTrickHoldMs = Math.max(
  0,
  completedTrickLingerMs - completedTrickCollectMs,
);
const trumpSelectionPhases: BelotPublicState["phase"][] = [
  "trump-round-one",
  "trump-round-two",
  "mus",
];
const trumpSelectionPassButtonClassName = "min-w-[5.25rem]";

type CardCollectionTransform = {
  x: number;
  y: number;
};

type BelotDebugHand = {
  label: string;
  cards: Card[];
  pickupCardIds?: string[];
};

function compareCardsWithinSuit(left: Card, right: Card, trumpSuit?: Suit) {
  if (trumpSuit) {
    const pointComparison =
      belotCardPoints(left, trumpSuit) - belotCardPoints(right, trumpSuit);

    if (pointComparison !== 0) {
      return pointComparison;
    }
  }

  return rankOrder.indexOf(left.rank) - rankOrder.indexOf(right.rank);
}

function sortCards(cards: Card[], trumpSuit?: Suit) {
  return [...cards].sort((left, right) => {
    const suitComparison =
      suitOrder.indexOf(left.suit) - suitOrder.indexOf(right.suit);

    return suitComparison === 0
      ? compareCardsWithinSuit(left, right, trumpSuit)
      : suitComparison;
  });
}

function groupCardsBySuit(cards: Card[]) {
  return suitOrder
    .map((suit) => ({
      suit,
      cards: cards.filter((card) => card.suit === suit),
    }))
    .filter((group) => group.cards.length > 0);
}

function sortDeclarationCards(cards: Card[]) {
  return [...cards].sort((left, right) => {
    const rankComparison =
      rankOrder.indexOf(left.rank) - rankOrder.indexOf(right.rank);

    return rankComparison === 0
      ? suitOrder.indexOf(left.suit) - suitOrder.indexOf(right.suit)
      : rankComparison;
  });
}

function sortDeclarations(declarations: BelotDeclaration[]) {
  return [...declarations].sort((left, right) => {
    const leftCards = sortDeclarationCards(left.cards);
    const rightCards = sortDeclarationCards(right.cards);
    const leftFirst = leftCards[0];
    const rightFirst = rightCards[0];

    if (!leftFirst || !rightFirst) {
      return left.cards.length - right.cards.length;
    }

    const rankComparison =
      rankOrder.indexOf(leftFirst.rank) - rankOrder.indexOf(rightFirst.rank);
    const suitComparison =
      suitOrder.indexOf(leftFirst.suit) - suitOrder.indexOf(rightFirst.suit);

    return (
      rankComparison || suitComparison || left.type.localeCompare(right.type)
    );
  });
}

function visibleDeclarationGroups(declarations: BelotDeclaration[]) {
  const ordinaryDeclarationCardIds = new Set(
    declarations
      .filter((declaration) => declaration.type !== "BELOTE")
      .flatMap((declaration) => declaration.cards.map((card) => card.id)),
  );

  return declarations.filter((declaration) => {
    if (declaration.type !== "BELOTE") {
      return true;
    }

    return !declaration.cards.every((card) =>
      ordinaryDeclarationCardIds.has(card.id),
    );
  });
}

function declarationPoints(declarations: BelotDeclaration[]) {
  return declarations.reduce(
    (total, declaration) => total + declaration.points,
    0,
  );
}

function trumpSelectionPreviewSuits(state: BelotPublicState) {
  if (!trumpSelectionPhases.includes(state.phase) || !state.upcard) {
    return [];
  }

  if (state.phase === "trump-round-one") {
    return [state.upcard.suit];
  }

  return suitOrder.filter((suit) => suit !== state.upcard?.suit);
}

function trumpSelectionBonusPreview(hand: Card[], state: BelotPublicState) {
  const previewCardIds = new Set<string>();
  let bestPoints = 0;

  for (const suit of trumpSelectionPreviewSuits(state)) {
    const declarations = autoSelectBelotDeclarations(hand, suit);
    const points = declarationPoints(declarations);

    for (const declaration of declarations) {
      for (const card of declaration.cards) {
        previewCardIds.add(card.id);
      }
    }

    if (points > bestPoints) {
      bestPoints = points;
    }
  }

  return {
    cardIds: previewCardIds,
    points: bestPoints,
  };
}

function SuitImage({
  suit,
  className = "h-10 w-10",
}: {
  suit: Suit;
  className?: string;
}) {
  const { messages } = useI18n();

  return (
    <img
      src={suitImagePaths[suit]}
      alt={messages.suits[suit]}
      className={`${className} object-contain`}
      loading="eager"
      decoding="async"
    />
  );
}

function TrumpMarkedCard({
  card,
  trumpSuit,
  reserveTrumpMarker = false,
  bonusMarked = false,
  reserveBonusMarker = false,
  children,
}: {
  card: Card;
  trumpSuit?: Suit;
  reserveTrumpMarker?: boolean;
  bonusMarked?: boolean;
  reserveBonusMarker?: boolean;
  children: ReactNode;
}) {
  const { messages } = useI18n();
  const isTrump = card.suit === trumpSuit;
  const showTrumpMarker = Boolean(trumpSuit) || reserveTrumpMarker;
  const showMarkerRow = showTrumpMarker || reserveBonusMarker;

  return (
    <span
      className="flex flex-col items-center"
      data-testid={
        isTrump
          ? "belot-trump-card"
          : bonusMarked
            ? "belot-bonus-card"
            : undefined
      }
    >
      {showMarkerRow ? (
        <span className="belot-card-marker-row mb-1 flex h-5 items-center justify-center gap-1">
          {showTrumpMarker ? (
            <span
              className={`belot-card-marker grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold uppercase leading-none text-ink ${
                isTrump ? "bg-yellow-300 shadow-sm" : "invisible"
              }`}
              aria-hidden={!isTrump}
            >
              {isTrump ? messages.trumpMarker : ""}
            </span>
          ) : null}
          {reserveBonusMarker ? (
            <span
              className={`belot-card-marker grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold uppercase leading-none text-ink ${
                bonusMarked ? "bg-emerald-300 shadow-sm" : "invisible"
              }`}
              aria-hidden={!bonusMarked}
            >
              {bonusMarked ? messages.bonusMarker : ""}
            </span>
          ) : null}
        </span>
      ) : null}
      {children}
    </span>
  );
}

function PickupCardFrame({
  pickedUp,
  ringClassName = "ring-cyan-200 ring-offset-1 ring-offset-ink md:ring-offset-2",
  children,
}: {
  pickedUp: boolean;
  ringClassName?: string;
  children: ReactNode;
}) {
  const ringClass = pickedUp ? `ring-2 md:ring-4 ${ringClassName}` : "";

  return (
    <span className={`inline-flex rounded md:rounded-md ${ringClass}`}>
      {children}
    </span>
  );
}

function trickStrengthMap(trick: BelotTrickPlay[], trumpSuit?: Suit) {
  if (!trick.length || !trumpSuit) {
    return new Map<string, boolean>();
  }

  const trumpPlays = trick.filter((play) => play.card.suit === trumpSuit);
  const relevantPlays = trumpPlays.length
    ? trumpPlays
    : trick.filter((play) => play.card.suit === trick[0]?.card.suit);
  const strongest = relevantPlays.reduce((winner, play) => {
    if (play.card.suit !== winner.card.suit) {
      return winner;
    }

    return compareBelotCards(play.card, winner.card, trumpSuit) > 0
      ? play
      : winner;
  });

  return new Map(trick.map((play) => [play.card.id, play === strongest]));
}

function trickCardKey(play: BelotTrickPlay) {
  return `${play.playerId}-${play.card.id}`;
}

function visibleGamePointsByPlayer(state: BelotPublicState) {
  const points = Object.fromEntries(
    state.players.map((player) => [player.playerId, 0]),
  ) as Record<string, number>;

  if (state.lastHandResult) {
    return { ...points, ...state.lastHandResult.gamePointsByPlayer };
  }

  if (!state.trumpSuit) {
    return points;
  }

  for (const trick of state.completedTricks) {
    points[trick.winnerPlayerId] =
      (points[trick.winnerPlayerId] ?? 0) +
      trick.cards.reduce(
        (sum, play) => sum + belotCardPoints(play.card, state.trumpSuit!),
        0,
      );
  }

  return points;
}

function playerName(
  state: BelotPublicState,
  messages: Messages,
  playerId?: string,
) {
  return (
    state.players.find((player) => player.playerId === playerId)?.displayName ??
    messages.unknownPlayer
  );
}

function statusPlayerName(
  state: BelotPublicState,
  messages: Messages,
  playerId?: string,
  currentPlayerId?: string,
) {
  if (playerId && currentPlayerId && playerId === currentPlayerId) {
    return messages.statusYou;
  }

  return playerName(state, messages, playerId);
}

function timelinePlayers(state: BelotPublicState) {
  const handResults =
    state.handResults ?? (state.lastHandResult ? [state.lastHandResult] : []);
  const firstDealerPlayerId =
    handResults[0]?.dealerPlayerId ??
    state.dealerPlayerId ??
    state.players[0]?.playerId;
  const firstDealer = state.players.find(
    (player) => player.playerId === firstDealerPlayerId,
  );
  const otherPlayer = state.players.find(
    (player) => player.playerId !== firstDealerPlayerId,
  );

  return [firstDealer, otherPlayer].filter(
    Boolean,
  ) as BelotPublicState["players"];
}

function perspectivePlayers(
  players: BelotPublicState["players"],
  currentPlayerId?: string,
) {
  if (!currentPlayerId) {
    return players;
  }

  const currentPlayer = players.find(
    (player) => player.playerId === currentPlayerId,
  );

  if (!currentPlayer) {
    return players;
  }

  return [
    currentPlayer,
    ...players.filter((player) => player.playerId !== currentPlayerId),
  ];
}

function BelotGameTimeline({
  handResults,
  players,
}: {
  handResults: BelotHandResult[];
  players: BelotPublicState["players"];
}) {
  const { messages } = useI18n();

  return (
    <section
      className="belot-game-timeline min-w-0"
      data-testid="belot-game-timeline"
    >
      <h3 className="text-sm font-semibold">{messages.gameTimeline}</h3>
      <div className="belot-game-timeline-scroll mt-2 overflow-x-auto">
        <table className="belot-game-timeline-table w-full min-w-[18rem] table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/15 text-xs">
              <th
                className="belot-game-timeline-hand-col w-12 py-1 pr-2 text-left font-medium uppercase text-white/60"
                scope="col"
              >
                {messages.hand}
              </th>
              {players.map((player) => (
                <th
                  key={player.playerId}
                  className="truncate px-2 py-1 text-right font-bold text-white"
                  scope="col"
                >
                  {player.displayName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {handResults.length ? (
              handResults.map((result, index) => (
                <tr
                  key={`${index}-${result.callerPlayerId}-${result.lastTrickWinnerPlayerId}`}
                  className={
                    index % 2 === 1 ? "border-b border-white/15" : undefined
                  }
                  data-testid="belot-game-timeline-row"
                >
                  <th
                    className="belot-game-timeline-hand-col py-2 pr-2 text-left align-top font-medium text-white/70"
                    scope="row"
                  >
                    <span className="block">{index + 1}</span>
                  </th>
                  {players.map((player) => {
                    const handScore =
                      result.handScoreByPlayer[player.playerId] ?? 0;
                    const bonusPoints =
                      result.declarationPointsByPlayer[player.playerId] ?? 0;
                    const isCaller = result.callerPlayerId === player.playerId;

                    return (
                      <td
                        key={`${index}-${player.playerId}`}
                        className="belot-game-timeline-player-cell px-2 py-2 align-top"
                      >
                        <div className="belot-game-timeline-score grid grid-cols-[3ch_1.25rem_4ch] items-center justify-end gap-1">
                          <span className="text-right text-[11px] uppercase leading-none text-white">
                            {isCaller && result.isMus ? messages.mus : ""}
                          </span>
                          {isCaller && result.trumpSuit ? (
                            <SuitImage
                              suit={result.trumpSuit}
                              className="h-5 w-5"
                            />
                          ) : (
                            <span aria-hidden="true" />
                          )}
                          <span className="text-right text-base font-semibold leading-none tabular-nums">
                            {handScore}
                          </span>
                        </div>
                        <p className="mt-1 text-right text-xs text-white/60">
                          {bonusPoints} {messages.bonus}
                        </p>
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={players.length + 1}
                  className="py-3 text-sm text-white/60"
                >
                  {messages.noHandsScored}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/15">
              <th
                className="py-2 pr-2 text-left text-xs uppercase text-white/60"
                scope="row"
              >
                {messages.total}
              </th>
              {players.map((player) => (
                <td
                  key={player.playerId}
                  className="px-2 py-2 text-right text-lg font-bold leading-none tabular-nums"
                >
                  {player.totalScore}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function trumpSelectionLogs(
  state: BelotPublicState,
  messages: Messages,
  currentPlayerId?: string,
) {
  if (!trumpSelectionPhases.includes(state.phase)) {
    return [];
  }

  const logs: string[] = [];
  const upcardSuit = state.upcard?.suit;
  const upcardSuitLabel = upcardSuit ? messages.suits[upcardSuit] : undefined;
  const isCurrentPlayerTurn =
    Boolean(currentPlayerId) && state.trumpTurnPlayerId === currentPlayerId;
  const turnPlayer = statusPlayerName(
    state,
    messages,
    state.trumpTurnPlayerId,
    currentPlayerId,
  );
  const passedPlayers = state.trumpPasses ?? [];

  if (state.upcard && upcardSuitLabel) {
    logs.push(messages.upcardIs(state.upcard.rank, upcardSuitLabel));
  }

  if (state.phase === "trump-round-one") {
    for (const playerId of passedPlayers) {
      logs.push(
        messages.playerPassedOnSuit(
          statusPlayerName(state, messages, playerId, currentPlayerId),
          upcardSuitLabel ?? messages.upcardSuit,
        ),
      );
    }

    logs.push(
      isCurrentPlayerTurn
        ? messages.youDecidingUpcard
        : messages.playerDecidingUpcard(turnPlayer),
    );
    return logs;
  }

  if (upcardSuitLabel) {
    logs.push(messages.bothPlayersPassedSuit(upcardSuitLabel));
  }

  if (state.phase === "trump-round-two") {
    for (const playerId of passedPlayers) {
      logs.push(
        messages.playerPassedChoosingAnotherSuit(
          statusPlayerName(state, messages, playerId, currentPlayerId),
        ),
      );
    }

    logs.push(
      isCurrentPlayerTurn
        ? messages.youChoosingOtherSuit(upcardSuitLabel ?? messages.upcardSuit)
        : messages.playerChoosingOtherSuit(
            turnPlayer,
            upcardSuitLabel ?? messages.upcardSuit,
          ),
    );
    return logs;
  }

  logs.push(messages.bothPlayersPassedTwice);
  logs.push(
    isCurrentPlayerTurn
      ? messages.youMustChooseTrumpOnMus
      : messages.playerMustChooseTrumpOnMus(turnPlayer),
  );
  return logs;
}

function playedCardsByPlayer(state: BelotPublicState) {
  const cardsByPlayer = Object.fromEntries(
    state.players.map((player) => [player.playerId, [] as Card[]]),
  ) as Record<string, Card[]>;

  for (const trick of state.completedTricks) {
    for (const play of trick.cards) {
      cardsByPlayer[play.playerId]?.push(play.card);
    }
  }

  for (const play of state.currentTrick) {
    cardsByPlayer[play.playerId]?.push(play.card);
  }

  return Object.fromEntries(
    Object.entries(cardsByPlayer).map(([playerId, cards]) => [
      playerId,
      sortCards(cards, state.trumpSuit),
    ]),
  ) as Record<string, Card[]>;
}

function ResultCardRow({
  label,
  cards,
  pickupCardIds,
  trumpSuit,
}: {
  label: string;
  cards: Card[];
  pickupCardIds?: string[];
  trumpSuit?: Suit;
}) {
  const { messages } = useI18n();
  const hiddenPickupCardIds = new Set(pickupCardIds ?? []);
  const suitGroups = groupCardsBySuit(sortCards(cards, trumpSuit));

  return (
    <div
      className="belot-result-card-row flex items-start gap-3"
      data-testid="belot-result-card-row"
    >
      <p className="w-24 shrink-0 pt-8 text-sm font-semibold">{label}:</p>
      <div className="flex min-h-24 min-w-0 flex-1 flex-wrap gap-x-4 gap-y-2 overflow-x-auto px-1 py-1">
        {suitGroups.map((group) => (
          <div key={group.suit} className="flex flex-wrap gap-2">
            {group.cards.map((card) => {
              const pickedUp = hiddenPickupCardIds.has(card.id);

              return (
                <div key={card.id} className="relative shrink-0 rounded-md">
                  <TrumpMarkedCard card={card} trumpSuit={trumpSuit}>
                    <PickupCardFrame pickedUp={pickedUp}>
                      <PlayingCard card={card} compact />
                    </PickupCardFrame>
                  </TrumpMarkedCard>
                  {pickedUp ? (
                    <span className="sr-only">{messages.hiddenPickupCard}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DebugHandPanel({
  debugHand,
  trumpSuit,
}: {
  debugHand: BelotDebugHand;
  trumpSuit?: Suit;
}) {
  const { messages } = useI18n();
  const pickupCardIds = new Set(debugHand.pickupCardIds ?? []);
  const suitGroups = groupCardsBySuit(sortCards(debugHand.cards, trumpSuit));

  return (
    <section
      className="mt-4 rounded-md border border-yellow-300/40 bg-yellow-300/10 p-3"
      data-testid="belot-debug-cpu-hand"
    >
      <h3 className="text-sm font-semibold text-yellow-100">
        {debugHand.label}
      </h3>
      <div className="mt-2 flex min-h-24 flex-wrap gap-x-4 gap-y-2 overflow-x-auto px-1 py-1">
        {suitGroups.length ? (
          suitGroups.map((group) => (
            <div
              key={group.suit}
              className="belot-debug-hand-suit-group flex flex-wrap gap-2"
            >
              {group.cards.map((card) => {
                const pickedUp = pickupCardIds.has(card.id);

                return (
                  <div
                    key={card.id}
                    className="relative shrink-0 rounded-md"
                    data-testid="belot-debug-cpu-hand-card"
                  >
                    <TrumpMarkedCard card={card} trumpSuit={trumpSuit}>
                      <PickupCardFrame pickedUp={pickedUp}>
                        <PlayingCard card={card} compact />
                      </PickupCardFrame>
                    </TrumpMarkedCard>
                    {pickedUp ? (
                      <span className="sr-only">
                        {messages.hiddenPickupCard}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <p className="text-sm text-white/70">{messages.drawn}</p>
        )}
      </div>
    </section>
  );
}

function WinnerPanel({
  playerName,
  className,
  compact = false,
  onRestart,
}: {
  playerName: string;
  className: string;
  compact?: boolean;
  onRestart: () => void;
}) {
  const { messages } = useI18n();

  return (
    <div
      className={`${compact ? "" : "mt-4"} rounded-md p-3 text-center ${className}`}
      data-testid="belot-winner"
    >
      <p className="text-lg font-bold">{messages.winner(playerName)}</p>
      <div className="mt-3">
        <Button onClick={onRestart}>{messages.nextGame}</Button>
      </div>
    </div>
  );
}

export function BelotTable({
  state,
  currentPlayerId,
  onTrumpDecision,
  onDeclare,
  onPlayCard,
  onNextHand,
  onRestart,
  debugHand,
  resignConfirmation,
}: {
  state: BelotPublicState;
  currentPlayerId?: string;
  onTrumpDecision: (
    decision:
      | { kind: "pass" }
      | { kind: "accept-upcard" }
      | { kind: "choose-suit"; suit: Suit },
  ) => void;
  onDeclare: (declarations: BelotDeclaration[]) => void;
  onPlayCard: (cardId: string) => void;
  onNextHand: () => void;
  onRestart: () => void;
  debugHand?: BelotDebugHand;
  resignConfirmation?: {
    onConfirm: () => void;
    onCancel: () => void;
  };
}) {
  const { locale, messages } = useI18n();
  const rulesHref = `/rules/belot-user-${locale}.html`;
  const currentPlayer = state.players.find(
    (player) => player.playerId === currentPlayerId,
  );
  const currentHand = useMemo(
    () => currentPlayer?.hand ?? [],
    [currentPlayer?.hand],
  );
  const sortedCurrentHand = useMemo(
    () => sortCards(currentHand, state.trumpSuit),
    [currentHand, state.trumpSuit],
  );
  const currentHandSuitGroups = useMemo(
    () => groupCardsBySuit(sortedCurrentHand),
    [sortedCurrentHand],
  );
  const pickupCardIds = useMemo(
    () => new Set(currentPlayer?.pickupCardIds ?? []),
    [currentPlayer?.pickupCardIds],
  );
  const bonusPreview = useMemo(
    () => trumpSelectionBonusPreview(currentHand, state),
    [currentHand, state],
  );
  const showBonusPreview = bonusPreview.points > 0;
  const declarationSubmissionKeys = useRef(new Set<string>());
  const [lingeringTrick, setLingeringTrick] = useState<{
    trickNumber: number;
    winnerPlayerId: string;
    cards: BelotTrickPlay[];
    collecting: boolean;
  }>();
  const [cardCollectionTransforms, setCardCollectionTransforms] = useState<
    Record<string, CardCollectionTransform>
  >({});
  const [revealedHandResultKey, setRevealedHandResultKey] = useState<string>();
  const playerPanelRefs = useRef<Record<string, HTMLElement | null>>({});
  const trickCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const legalCardIds = useMemo(() => {
    if (
      state.phase !== "trick-play" ||
      state.currentTurnPlayerId !== currentPlayerId ||
      !state.trumpSuit
    ) {
      return new Set<string>();
    }

    return new Set(
      legalBelotCards(currentHand, state.currentTrick, state.trumpSuit).map(
        (card) => card.id,
      ),
    );
  }, [
    currentHand,
    currentPlayerId,
    state.currentTrick,
    state.currentTurnPlayerId,
    state.phase,
    state.trumpSuit,
  ]);

  const playedCardIds = useMemo(
    () =>
      new Set([
        ...state.currentTrick.map((play) => play.card.id),
        ...state.completedTricks.flatMap((trick) =>
          trick.cards.map((play) => play.card.id),
        ),
      ]),
    [state.completedTricks, state.currentTrick],
  );
  const declarationsByPlayer = useMemo(
    () =>
      Object.fromEntries(
        state.players.map((player) => [
          player.playerId,
          sortDeclarations(state.declarationsByPlayer[player.playerId] ?? []),
        ]),
      ) as Record<string, BelotDeclaration[]>,
    [state.declarationsByPlayer, state.players],
  );
  const visibleGamePoints = useMemo(
    () => visibleGamePointsByPlayer(state),
    [state],
  );
  const resultCardsByPlayer = useMemo(
    () => playedCardsByPlayer(state),
    [state],
  );
  const selectionLogs = trumpSelectionLogs(state, messages, currentPlayerId);
  const handResultKey = state.lastHandResult
    ? [
        state.completedTricks.length,
        state.lastHandResult.lastTrickWinnerPlayerId,
        ...state.players.map(
          (player) =>
            `${player.playerId}:${
              state.lastHandResult?.handScoreByPlayer[player.playerId] ?? 0
            }`,
        ),
      ].join("|")
    : undefined;
  const showHandResult = Boolean(
    handResultKey && revealedHandResultKey === handResultKey,
  );
  const waitingForHandResult = Boolean(handResultKey && !showHandResult);
  const resultDelayTrick = waitingForHandResult
    ? state.completedTricks.at(-1)
    : undefined;
  const visibleTrick = state.currentTrick.length
    ? {
        cards: state.currentTrick,
        strengthByCardId: trickStrengthMap(state.currentTrick, state.trumpSuit),
      }
    : lingeringTrick
      ? {
          cards: lingeringTrick.cards,
          strengthByCardId: new Map(
            lingeringTrick.cards.map((play) => [
              play.card.id,
              play.playerId === lingeringTrick.winnerPlayerId,
            ]),
          ),
        }
      : resultDelayTrick
        ? {
            cards: resultDelayTrick.cards,
            strengthByCardId: new Map(
              resultDelayTrick.cards.map((play) => [
                play.card.id,
                play.playerId === resultDelayTrick.winnerPlayerId,
              ]),
            ),
          }
        : undefined;
  const displayedCompletedTricks = state.completedTricks
    .map((trick, index) => ({ index, trick }))
    .reverse();
  const handResults =
    state.handResults ?? (state.lastHandResult ? [state.lastHandResult] : []);
  const timelineOrderedPlayers = timelinePlayers(state);
  const displayedPlayers = useMemo(
    () => perspectivePlayers(state.players, currentPlayerId),
    [currentPlayerId, state.players],
  );
  const turnPlayerId =
    state.phase === "trick-play"
      ? state.currentTurnPlayerId
      : state.trumpTurnPlayerId;
  const collectTrickCards = useCallback(
    (trickNumber: number, winnerPlayerId: string, cards: BelotTrickPlay[]) => {
      const targetElement = playerPanelRefs.current[winnerPlayerId];

      if (!targetElement) {
        setLingeringTrick((current) =>
          current?.trickNumber === trickNumber
            ? { ...current, collecting: true }
            : current,
        );
        return;
      }

      const targetPlayerIndex = displayedPlayers.findIndex(
        (player) => player.playerId === winnerPlayerId,
      );
      const targetRect = targetElement.getBoundingClientRect();
      const targetX =
        targetPlayerIndex === 0 ? targetRect.left : targetRect.right;
      const targetY = targetRect.top;

      const transforms = Object.fromEntries(
        cards.map((play) => {
          const cardElement = trickCardRefs.current[trickCardKey(play)];

          if (!cardElement) {
            return [trickCardKey(play), { x: 0, y: 0 }];
          }

          const cardRect = cardElement.getBoundingClientRect();
          const cardX = cardRect.left + cardRect.width / 2;
          const cardY = cardRect.top + cardRect.height / 2;

          return [
            trickCardKey(play),
            {
              x: Math.round(targetX - cardX),
              y: Math.round(targetY - cardY),
            },
          ];
        }),
      ) as Record<string, CardCollectionTransform>;

      setCardCollectionTransforms(transforms);
      setLingeringTrick((current) =>
        current?.trickNumber === trickNumber
          ? { ...current, collecting: true }
          : current,
      );
    },
    [displayedPlayers],
  );

  useEffect(() => {
    if (state.currentTrick.length || !state.completedTricks.length) {
      if (state.currentTrick.length) {
        setLingeringTrick(undefined);
        setCardCollectionTransforms({});
      }

      return;
    }

    const trickNumber = state.completedTricks.length;
    const lastTrick = state.completedTricks.at(-1);

    if (!lastTrick) {
      return;
    }

    setLingeringTrick({
      trickNumber,
      winnerPlayerId: lastTrick.winnerPlayerId,
      cards: lastTrick.cards,
      collecting: false,
    });
    setCardCollectionTransforms({});

    const collectTimeout = window.setTimeout(() => {
      collectTrickCards(trickNumber, lastTrick.winnerPlayerId, lastTrick.cards);
    }, completedTrickHoldMs);
    const hideTimeout = window.setTimeout(() => {
      setLingeringTrick((current) =>
        current?.trickNumber === trickNumber ? undefined : current,
      );
      setCardCollectionTransforms({});
    }, completedTrickLingerMs);

    return () => {
      window.clearTimeout(collectTimeout);
      window.clearTimeout(hideTimeout);
    };
  }, [collectTrickCards, state.completedTricks, state.currentTrick]);

  useEffect(() => {
    if (!handResultKey) {
      setRevealedHandResultKey(undefined);
      return;
    }

    const timeout = window.setTimeout(() => {
      setRevealedHandResultKey(handResultKey);
    }, completedTrickLingerMs);

    return () => window.clearTimeout(timeout);
  }, [handResultKey]);

  useEffect(() => {
    if (
      state.phase !== "declarations" ||
      !state.trumpSuit ||
      !currentPlayerId ||
      !currentPlayer?.hand ||
      currentPlayer.declarationsSubmitted
    ) {
      return;
    }

    const submissionKey = `${currentPlayerId}:${state.trumpSuit}:${currentPlayer.hand
      .map((card) => card.id)
      .join(",")}`;

    if (declarationSubmissionKeys.current.has(submissionKey)) {
      return;
    }

    declarationSubmissionKeys.current.add(submissionKey);
    onDeclare(autoSelectBelotDeclarations(currentPlayer.hand, state.trumpSuit));
  }, [currentPlayer, currentPlayerId, onDeclare, state.phase, state.trumpSuit]);

  const selectableSuits = state.upcard
    ? suitOrder.filter((suit) => suit !== state.upcard?.suit)
    : [];
  const resultCurrentPlayer = currentPlayer ?? state.players[0];
  const resultOpponentPlayer =
    state.players.find(
      (player) => player.playerId !== resultCurrentPlayer?.playerId,
    ) ?? state.players[1];
  const winnerPlayer = state.players.find(
    (player) => player.playerId === state.winnerPlayerId,
  );
  const winnerPanelWinClass = "bg-sky-300 text-ink";
  const winnerPanelLossClass = "bg-red-300 text-ink";
  const winnerPanelClass =
    state.winnerPlayerId === currentPlayerId
      ? winnerPanelWinClass
      : winnerPanelLossClass;
  const showFinishedWinnerInTrickArea = Boolean(
    winnerPlayer && state.phase === "finished" && !showHandResult,
  );
  const showTrickArea =
    !showHandResult &&
    (Boolean(resignConfirmation) ||
      showFinishedWinnerInTrickArea ||
      state.phase === "trick-play" ||
      trumpSelectionPhases.includes(state.phase) ||
      Boolean(visibleTrick));
  const showWinnerPanel = Boolean(winnerPlayer && showHandResult);
  const playerPanels = displayedPlayers.map((player) => {
    const declarations = declarationsByPlayer[player.playerId] ?? [];
    const declarationGroups = visibleDeclarationGroups(declarations);
    const bonusPoints = declarations.reduce(
      (total, declaration) => total + declaration.points,
      0,
    );
    const gamePoints =
      typeof player.gamePoints === "number"
        ? player.gamePoints
        : (visibleGamePoints[player.playerId] ?? 0);

    const isTurnToPlay = turnPlayerId === player.playerId;

    return (
      <article
        key={player.playerId}
        ref={(element) => {
          playerPanelRefs.current[player.playerId] = element;
        }}
        className="belot-player-panel min-w-0 rounded-md bg-white/10 p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 font-semibold">
            <span className="truncate">{player.displayName}</span>
            {isTurnToPlay ? (
              <span
                aria-label={messages.toPlay(player.displayName)}
                className="relative inline-flex h-4 w-4 shrink-0"
                role="progressbar"
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-300 opacity-60" />
                <span className="relative inline-flex h-4 w-4 rounded-full border-2 border-yellow-200 border-t-transparent animate-spin" />
              </span>
            ) : null}
          </h3>
          <p className="text-xl font-bold leading-none text-white">
            {player.totalScore}
          </p>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs uppercase text-white/60">
            {state.dealerPlayerId === player.playerId
              ? messages.dealer
              : messages.first}
            {state.callerPlayerId === player.playerId ? (
              <>
                {" - "}
                <span className="font-bold text-yellow-300">
                  {messages.caller}
                  {state.isMus ? ` (${messages.mus.toUpperCase()})` : ""}
                </span>
              </>
            ) : null}
          </p>
          <p className="text-xl font-bold leading-none text-yellow-300">
            {gamePoints}
          </p>
        </div>
        {declarations.length ? (
          <div className="mt-3 min-w-0">
            <p className="mb-1 text-xs font-semibold text-white/70">
              {messages.bonusPts(bonusPoints)}
            </p>
            <div className="belot-declaration-list flex flex-wrap gap-x-4 gap-y-2">
              {declarationGroups.map((declaration, declarationIndex) => (
                <div
                  key={`${declaration.type}-${declarationIndex}`}
                  className="belot-declaration-group flex flex-wrap gap-2"
                  data-testid="belot-declaration-group"
                >
                  {sortDeclarationCards(declaration.cards).map((card) => (
                    <div
                      key={card.id}
                      className={playedCardIds.has(card.id) ? "opacity-45" : ""}
                    >
                      <TrumpMarkedCard card={card} trumpSuit={state.trumpSuit}>
                        <PlayingCard card={card} compact />
                      </TrumpMarkedCard>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </article>
    );
  });

  return (
    <section className="belot-table rounded-md bg-felt p-4 text-white shadow-lg">
      <div className="belot-scoreboard grid gap-3">
        {playerPanels[0]}
        <div className="belot-center-panel min-w-0 rounded-md bg-white/10 p-3">
          <div className="flex flex-col items-center gap-4">
            {state.upcard ? (
              <div className="belot-center-upcard text-center">
                <p className="mb-1 text-sm font-semibold">{messages.upcard}</p>
                <TrumpMarkedCard
                  card={state.upcard}
                  trumpSuit={state.trumpSuit}
                  reserveTrumpMarker
                >
                  <PlayingCard card={state.upcard} compact />
                </TrumpMarkedCard>
              </div>
            ) : null}
            {state.trumpSuit && state.upcard ? (
              <div
                aria-hidden="true"
                className="h-px w-full bg-white/15"
                data-testid="belot-trump-upcard-separator"
              />
            ) : null}
            {state.trumpSuit ? (
              <div className="text-center">
                <p className="mb-1 text-sm font-semibold">{messages.trump}</p>
                <SuitImage
                  suit={state.trumpSuit}
                  className="belot-center-trump-suit"
                />
              </div>
            ) : null}
            {showHandResult && state.lastHandResult ? (
              <div
                className="w-full border-t border-white/15 pt-3 text-center"
                data-testid="belot-hand-result"
              >
                <p className="mb-2 text-sm font-semibold">
                  {messages.handResult}
                </p>
                <div className="grid grid-cols-2 items-center gap-4">
                  {displayedPlayers.slice(0, 2).map((player, index) => (
                    <p
                      key={player.playerId}
                      aria-label={
                        index === 0
                          ? messages.leftHandResult
                          : messages.rightHandResult
                      }
                      className={`text-xl font-bold leading-none text-white tabular-nums ${
                        index === 0 ? "text-left" : "text-right"
                      }`}
                      data-testid="belot-result-score"
                    >
                      {state.lastHandResult?.handScoreByPlayer[
                        player.playerId
                      ] ?? 0}
                    </p>
                  ))}
                </div>
                {state.phase === "hand-complete" && !state.winnerPlayerId ? (
                  <div className="mt-3">
                    <Button
                      className="belot-next-hand-button"
                      onClick={onNextHand}
                    >
                      {messages.nextHand}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {playerPanels[1]}
      </div>

      {debugHand ? (
        <DebugHandPanel debugHand={debugHand} trumpSuit={state.trumpSuit} />
      ) : null}

      {state.trumpTurnPlayerId === currentPlayerId ? (
        <div className="mt-4 rounded-md bg-white/10 p-3 text-white">
          <p className="text-sm font-semibold">{messages.chooseTrump}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {state.phase === "trump-round-one" ? (
              <Button
                onClick={() => onTrumpDecision({ kind: "accept-upcard" })}
                aria-label={
                  state.upcard
                    ? messages.acceptSuit(messages.suits[state.upcard.suit])
                    : messages.acceptUpcard
                }
              >
                <span className="inline-flex items-center gap-2">
                  {messages.accept}
                  {state.upcard ? (
                    <SuitImage
                      suit={state.upcard.suit}
                      className="belot-trump-button-suit h-7 w-7"
                    />
                  ) : null}
                </span>
              </Button>
            ) : null}
            {state.phase !== "mus" ? (
              <Button
                className={trumpSelectionPassButtonClassName}
                onClick={() => onTrumpDecision({ kind: "pass" })}
              >
                {messages.pass}
              </Button>
            ) : null}
            {state.phase === "trump-round-two" || state.phase === "mus"
              ? selectableSuits.map((suit) => (
                  <Button
                    key={suit}
                    onClick={() =>
                      onTrumpDecision({ kind: "choose-suit", suit })
                    }
                    aria-label={messages.chooseSuit(messages.suits[suit])}
                  >
                    <SuitImage
                      suit={suit}
                      className="belot-trump-button-suit h-9 w-9"
                    />
                  </Button>
                ))
              : null}
          </div>
        </div>
      ) : null}

      {showTrickArea ? (
        <div
          className="mt-4 rounded-md bg-white/10 p-3"
          data-testid="belot-current-trick"
        >
          {resignConfirmation ? (
            <div className="flex min-h-[114px] flex-col items-center justify-center gap-3 text-center">
              <p className="text-lg font-bold">{messages.confirmResignGame}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" onClick={resignConfirmation.onConfirm}>
                  {messages.yes}
                </Button>
                <Button type="button" onClick={resignConfirmation.onCancel}>
                  {messages.no}
                </Button>
              </div>
            </div>
          ) : showFinishedWinnerInTrickArea && winnerPlayer ? (
            <WinnerPanel
              playerName={winnerPlayer.displayName}
              className={winnerPanelClass}
              compact
              onRestart={onRestart}
            />
          ) : selectionLogs.length ? (
            <>
              <p className="mb-2 text-sm font-semibold">
                {messages.trumpSelection}
              </p>
              <ol className="min-h-[114px] space-y-2 text-sm text-white/85">
                {selectionLogs.map((log, index) => (
                  <li
                    key={`${index}-${log}`}
                    className="rounded-md bg-black/15 px-3 py-2"
                  >
                    {log}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="belot-current-trick-grid grid h-[138px] grid-cols-[repeat(2,71px)] items-start justify-center gap-3 overflow-visible">
              {visibleTrick?.cards.map((play) => {
                const cardKey = trickCardKey(play);
                const collectionTransform = lingeringTrick?.collecting
                  ? cardCollectionTransforms[cardKey]
                  : undefined;
                const isWeakerCard =
                  visibleTrick.strengthByCardId.size &&
                  !visibleTrick.strengthByCardId.get(play.card.id);

                return (
                  <div
                    key={cardKey}
                    ref={(element) => {
                      trickCardRefs.current[cardKey] = element;
                    }}
                    className={`transition-[transform,opacity] ease-in ${
                      isWeakerCard ? "opacity-75" : ""
                    }`}
                    data-collecting={collectionTransform ? "true" : undefined}
                    data-testid="belot-current-trick-card"
                    style={{
                      opacity: collectionTransform
                        ? 0.35
                        : isWeakerCard
                          ? undefined
                          : 1,
                      transform: collectionTransform
                        ? `translate3d(${collectionTransform.x}px, ${collectionTransform.y}px, 0) scale(0.35)`
                        : undefined,
                      transitionDuration: `${completedTrickCollectMs}ms`,
                    }}
                  >
                    <TrumpMarkedCard
                      card={play.card}
                      trumpSuit={state.trumpSuit}
                    >
                      <PlayingCard card={play.card} native />
                    </TrumpMarkedCard>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {showWinnerPanel || showHandResult ? (
        <>
          {showWinnerPanel && winnerPlayer ? (
            <WinnerPanel
              playerName={winnerPlayer.displayName}
              className={winnerPanelClass}
              onRestart={onRestart}
            />
          ) : null}
          {showHandResult ? (
            <div
              className="belot-starting-cards mt-4 rounded-md bg-white/10 p-3 text-white"
              data-testid="belot-starting-cards"
            >
              <h3 className="font-bold">{messages.startingCards}</h3>
              <div className="mt-2 space-y-4">
                {resultCurrentPlayer ? (
                  <ResultCardRow
                    label={resultCurrentPlayer.displayName}
                    cards={
                      resultCardsByPlayer[resultCurrentPlayer.playerId] ?? []
                    }
                    pickupCardIds={resultCurrentPlayer.pickupCardIds}
                    trumpSuit={state.trumpSuit}
                  />
                ) : null}
                {resultOpponentPlayer ? (
                  <ResultCardRow
                    label={resultOpponentPlayer.displayName}
                    cards={
                      resultCardsByPlayer[resultOpponentPlayer.playerId] ?? []
                    }
                    pickupCardIds={resultOpponentPlayer.pickupCardIds}
                    trumpSuit={state.trumpSuit}
                  />
                ) : null}
                <ResultCardRow
                  label={messages.remainingCards}
                  cards={state.unusedCards ?? []}
                  trumpSuit={state.trumpSuit}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : currentHand.length ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">
            <span>{messages.yourHand}</span>
            <a
              href={rulesHref}
              target="_blank"
              rel="noreferrer"
              aria-label={messages.rules}
              title={messages.rules}
              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/50 text-xs font-bold leading-none text-white/85 hover:border-white hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70"
            >
              ?
            </a>
            {state.currentTurnPlayerId === currentPlayerId
              ? ` · ${messages.playLegalCard}`
              : ""}
          </p>
          <div className="belot-hand-row flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="belot-hand-cards flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-2">
              {currentHandSuitGroups.map((group) => (
                <div
                  key={group.suit}
                  className="belot-hand-suit-group flex flex-wrap gap-2"
                  data-testid="belot-hand-suit-group"
                >
                  {group.cards.map((card) => {
                    const playable = legalCardIds.has(card.id);
                    const pickedUp = pickupCardIds.has(card.id);
                    const bonusMarked = bonusPreview.cardIds.has(card.id);
                    const canPlay =
                      state.phase === "trick-play" &&
                      state.currentTurnPlayerId === currentPlayerId &&
                      playable;
                    const shadowed = Boolean(state.trumpSuit) && !canPlay;

                    return (
                      <button
                        key={card.id}
                        type="button"
                        className={`belot-hand-card relative rounded-md disabled:cursor-default ${
                          shadowed ? "opacity-70" : ""
                        }`}
                        data-testid="belot-hand-card"
                        disabled={!canPlay}
                        onClick={() => onPlayCard(card.id)}
                      >
                        <TrumpMarkedCard
                          card={card}
                          trumpSuit={state.trumpSuit}
                          bonusMarked={bonusMarked}
                          reserveBonusMarker={showBonusPreview}
                        >
                          <PickupCardFrame pickedUp={pickedUp}>
                            <PlayingCard card={card} native />
                          </PickupCardFrame>
                        </TrumpMarkedCard>
                        {pickedUp ? (
                          <span className="sr-only">
                            {messages.hiddenPickupCard}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {showBonusPreview ? (
            <div
              className="belot-hand-bonus mt-8 flex justify-start"
              data-testid="belot-hand-bonus-total"
            >
              <span className="belot-hand-bonus-pill rounded-full bg-emerald-300 px-3 py-1 text-sm font-bold leading-none text-ink shadow-sm">
                {messages.bonusPts(bonusPreview.points)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 rounded-md bg-white/10 p-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]">
          <section
            className="belot-played-tricks min-w-0"
            data-testid="belot-played-tricks"
          >
            <h3 className="text-sm font-semibold">{messages.playedTricks}</h3>
            <div className="mt-2 space-y-3">
              {displayedCompletedTricks.length ? (
                displayedCompletedTricks.map(({ index, trick }, itemIndex) => (
                  <Fragment key={index}>
                    {itemIndex > 0 ? (
                      <div
                        aria-hidden="true"
                        className="h-px w-full bg-white/15"
                        data-testid="belot-played-trick-separator"
                      />
                    ) : null}
                    <div>
                      <p className="mb-2 text-sm font-semibold">
                        {messages.trickWinner(
                          index + 1,
                          state.players.find(
                            (player) =>
                              player.playerId === trick.winnerPlayerId,
                          )?.displayName,
                        )}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {trick.cards.map((play) => (
                          <div
                            key={`${index}-${play.playerId}-${play.card.id}`}
                            className={`belot-played-trick-card ${
                              play.playerId === trick.winnerPlayerId
                                ? ""
                                : "opacity-45"
                            }`}
                          >
                            <TrumpMarkedCard
                              card={play.card}
                              trumpSuit={state.trumpSuit}
                            >
                              <PlayingCard card={play.card} compact />
                            </TrumpMarkedCard>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Fragment>
                ))
              ) : (
                <p className="text-sm text-white/60">
                  {messages.noTricksCompleted}
                </p>
              )}
            </div>
          </section>
          <div
            aria-hidden="true"
            className="h-px w-full bg-white/15 md:h-auto md:w-px"
            data-testid="belot-details-separator"
          />
          <BelotGameTimeline
            handResults={handResults}
            players={timelineOrderedPlayers}
          />
        </div>
      </div>

      {state.error ? (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
