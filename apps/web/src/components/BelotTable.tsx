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
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { PlayingCard, PlayingCardBack } from "../game/cards";
import { Button } from "./Button";

const suitLabels: Record<Suit, string> = {
  acorns: "Acorns",
  bells: "Bells",
  hearts: "Hearts",
  leaves: "Leaves",
};

const suitImagePaths: Record<Suit, string> = {
  acorns: "/suits/s.png",
  bells: "/suits/d.png",
  hearts: "/suits/h.png",
  leaves: "/suits/c.png",
};

const suitOrder: Suit[] = ["acorns", "bells", "hearts", "leaves"];
const rankOrder: Rank[] = ["VII", "VIII", "IX", "X", "U", "O", "K", "A"];
const completedTrickLingerMs = 2_000;
const trumpSelectionPhases: BelotPublicState["phase"][] = [
  "trump-round-one",
  "trump-round-two",
  "mus",
];

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

function trumpSelectionBonusPreview(
  hand: Card[],
  state: BelotPublicState,
) {
  let bestDeclarations: BelotDeclaration[] = [];
  let bestPoints = 0;

  for (const suit of trumpSelectionPreviewSuits(state)) {
    const declarations = autoSelectBelotDeclarations(hand, suit);
    const points = declarationPoints(declarations);

    if (points > bestPoints) {
      bestDeclarations = declarations;
      bestPoints = points;
    }
  }

  return {
    cardIds: new Set(
      bestDeclarations.flatMap((declaration) =>
        declaration.cards.map((card) => card.id),
      ),
    ),
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
  return (
    <img
      src={suitImagePaths[suit]}
      alt={suitLabels[suit]}
      className={`${className} object-contain`}
      loading="lazy"
    />
  );
}

function TrumpMarkedCard({
  card,
  trumpSuit,
  bonusMarked = false,
  reserveBonusMarker = false,
  children,
}: {
  card: Card;
  trumpSuit?: Suit;
  bonusMarked?: boolean;
  reserveBonusMarker?: boolean;
  children: ReactNode;
}) {
  const isTrump = card.suit === trumpSuit;
  const reserveTrumpMarker = Boolean(trumpSuit);
  const showMarkerRow = reserveTrumpMarker || reserveBonusMarker;

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
        <span className="mb-1 flex h-5 items-center justify-center gap-1">
          {reserveTrumpMarker ? (
            <span
              className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold uppercase leading-none text-ink ${
                isTrump ? "bg-yellow-300 shadow-sm" : "invisible"
              }`}
              aria-hidden={!isTrump}
            >
              {isTrump ? "T" : ""}
            </span>
          ) : null}
          {reserveBonusMarker ? (
            <span
              className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold uppercase leading-none text-ink ${
                bonusMarked ? "bg-emerald-300 shadow-sm" : "invisible"
              }`}
              aria-hidden={!bonusMarked}
            >
              {bonusMarked ? "B" : ""}
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
  ringClassName = "ring-amber-600",
  children,
}: {
  pickedUp: boolean;
  ringClassName?: string;
  children: ReactNode;
}) {
  const ringClass = pickedUp ? `ring-4 ${ringClassName}` : "";

  return (
    <span className={`inline-flex rounded-md ${ringClass}`}>{children}</span>
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

function playerName(state: BelotPublicState, playerId?: string) {
  return (
    state.players.find((player) => player.playerId === playerId)?.displayName ??
    "Unknown player"
  );
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

function BelotGameTimeline({
  handResults,
  players,
}: {
  handResults: BelotHandResult[];
  players: BelotPublicState["players"];
}) {
  return (
    <section className="min-w-0" data-testid="belot-game-timeline">
      <h3 className="text-sm font-semibold">Game timeline</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[18rem] table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/15 text-xs">
              <th
                className="w-12 py-1 pr-2 text-left font-medium uppercase text-white/60"
                scope="col"
              >
                Hand
              </th>
              {players.map((player) => (
                <th
                  key={player.playerId}
                  className="px-2 py-1 text-right font-bold text-white"
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
                    className="py-2 pr-2 text-left align-top font-medium text-white/70"
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
                        className="px-2 py-2 align-top"
                      >
                        <div className="grid grid-cols-[3ch_1.25rem_4ch] items-center justify-end gap-1">
                          <span className="text-right text-[11px] uppercase leading-none text-white">
                            {isCaller && result.isMus ? "Mus" : ""}
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
                          {bonusPoints} bonus
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
                  No hands scored yet.
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
                Total
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

function trumpSelectionLogs(state: BelotPublicState) {
  if (!trumpSelectionPhases.includes(state.phase)) {
    return [];
  }

  const logs: string[] = [];
  const upcardSuit = state.upcard?.suit;
  const upcardSuitLabel = upcardSuit ? suitLabels[upcardSuit] : undefined;
  const turnPlayer = playerName(state, state.trumpTurnPlayerId);
  const passedPlayers = state.trumpPasses ?? [];

  if (state.upcard && upcardSuitLabel) {
    logs.push(`Upcard is ${state.upcard.rank} of ${upcardSuitLabel}.`);
  }

  if (state.phase === "trump-round-one") {
    for (const playerId of passedPlayers) {
      logs.push(
        `${playerName(state, playerId)} passed on ${upcardSuitLabel ?? "the upcard suit"}.`,
      );
    }

    logs.push(`${turnPlayer} is deciding whether to accept the upcard suit.`);
    return logs;
  }

  if (upcardSuitLabel) {
    logs.push(`Both players passed ${upcardSuitLabel}.`);
  }

  if (state.phase === "trump-round-two") {
    for (const playerId of passedPlayers) {
      logs.push(`${playerName(state, playerId)} passed choosing another suit.`);
    }

    logs.push(
      `${turnPlayer} is choosing a suit other than ${upcardSuitLabel ?? "the upcard suit"}.`,
    );
    return logs;
  }

  logs.push("Both players passed twice.");
  logs.push(`${turnPlayer} is on mus and must choose trump.`);
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
  const hiddenPickupCardIds = new Set(pickupCardIds ?? []);
  const suitGroups = groupCardsBySuit(sortCards(cards, trumpSuit));

  return (
    <div
      className="flex items-start gap-3"
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
                    <PickupCardFrame
                      pickedUp={pickedUp}
                      ringClassName="ring-amber-600"
                    >
                      <PlayingCard card={card} compact />
                    </PickupCardFrame>
                  </TrumpMarkedCard>
                  {pickedUp ? (
                    <span className="sr-only">Hidden pickup card</span>
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

function HiddenPickupPlaceholder({
  index,
  reserveMarkerRow = false,
}: {
  index: number;
  reserveMarkerRow?: boolean;
}) {
  return (
    <div
      className="relative shrink-0 rounded-md"
      data-testid="belot-hidden-pickup-placeholder"
    >
      {reserveMarkerRow ? (
        <span
          aria-hidden="true"
          className="mb-1 flex h-5 items-center justify-center"
          data-testid="belot-hidden-pickup-marker-spacer"
        />
      ) : null}
      <PlayingCardBack native alt={`Hidden pickup card ${index}`} />
      <span className="sr-only">Hidden pickup card</span>
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
}) {
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
  }>();
  const [showPlayedHands, setShowPlayedHands] = useState(false);
  const [revealedHandResultKey, setRevealedHandResultKey] = useState<string>();

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
  const selectionLogs = trumpSelectionLogs(state);
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
        label: "Current trick",
        cards: state.currentTrick,
        strengthByCardId: trickStrengthMap(state.currentTrick, state.trumpSuit),
      }
    : lingeringTrick
      ? {
          label: `Completed trick ${lingeringTrick.trickNumber}`,
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
            label: `Completed trick ${state.completedTricks.length}`,
            cards: resultDelayTrick.cards,
            strengthByCardId: new Map(
              resultDelayTrick.cards.map((play) => [
                play.card.id,
                play.playerId === resultDelayTrick.winnerPlayerId,
              ]),
            ),
          }
        : undefined;
  const showTrickArea =
    !showHandResult &&
    (state.phase === "trick-play" ||
      trumpSelectionPhases.includes(state.phase) ||
      Boolean(visibleTrick));
  const showHiddenPickupPlaceholders =
    trumpSelectionPhases.includes(state.phase) && currentHand.length > 0;
  const displayedCompletedTricks = state.completedTricks
    .map((trick, index) => ({ index, trick }))
    .reverse();
  const handResults =
    state.handResults ?? (state.lastHandResult ? [state.lastHandResult] : []);
  const timelineOrderedPlayers = timelinePlayers(state);
  const turnPlayerId =
    state.phase === "trick-play"
      ? state.currentTurnPlayerId
      : state.trumpTurnPlayerId;

  useEffect(() => {
    if (state.currentTrick.length || !state.completedTricks.length) {
      if (state.currentTrick.length) {
        setLingeringTrick(undefined);
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
    });

    const timeout = window.setTimeout(() => {
      setLingeringTrick((current) =>
        current?.trickNumber === trickNumber ? undefined : current,
      );
    }, completedTrickLingerMs);

    return () => window.clearTimeout(timeout);
  }, [state.completedTricks, state.currentTrick]);

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
    onDeclare(
      autoSelectBelotDeclarations(currentPlayer.hand, state.trumpSuit),
    );
  }, [currentPlayer, currentPlayerId, onDeclare, state.phase, state.trumpSuit]);

  const selectableSuits = state.upcard
    ? (Object.keys(suitLabels) as Suit[]).filter(
        (suit) => suit !== state.upcard?.suit,
      )
    : [];
  const resultCurrentPlayer = currentPlayer ?? state.players[0];
  const resultOpponentPlayer =
    state.players.find(
      (player) => player.playerId !== resultCurrentPlayer?.playerId,
    ) ?? state.players[1];
  const winnerPlayer = state.players.find(
    (player) => player.playerId === state.winnerPlayerId,
  );
  const playerPanels = state.players.map((player) => {
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
      <article key={player.playerId} className="rounded-md bg-white/10 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 font-semibold">
            <span className="truncate">{player.displayName}</span>
            {isTurnToPlay ? (
              <span
                aria-label={`${player.displayName} to play`}
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
            {state.dealerPlayerId === player.playerId ? "Dealer" : "First"}
            {state.callerPlayerId === player.playerId ? (
              <>
                {" - "}
                <span className="font-bold text-yellow-300">
                  CALLER{state.isMus ? " (MUS)" : ""}
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
              {bonusPoints} bonus pts
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {declarationGroups.map((declaration, declarationIndex) => (
                <div
                  key={`${declaration.type}-${declarationIndex}`}
                  className="flex flex-wrap gap-2"
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
    <section className="rounded-md bg-felt p-4 text-white shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Belot</h2>
          <p className="text-sm text-white/80" data-testid="belot-status">
            Status: {state.phase.replaceAll("-", " ")}
            {state.isMus ? " · Mus" : ""}
          </p>
        </div>
        {state.phase === "hand-complete" && !state.winnerPlayerId ? (
          <Button onClick={onNextHand}>Next hand</Button>
        ) : state.phase === "error" ? (
          <Button onClick={onRestart}>New game</Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
        {playerPanels[0]}
        <div className="rounded-md bg-white/10 p-3">
          <div className="flex flex-wrap items-start justify-center gap-4 md:flex-col md:items-center">
            {state.trumpSuit ? (
              <div className="text-center">
                <p className="mb-1 text-sm font-semibold">Trump</p>
                <SuitImage suit={state.trumpSuit} className="h-12 w-12" />
              </div>
            ) : null}
            {state.trumpSuit && state.upcard ? (
              <div
                aria-hidden="true"
                className="h-24 w-px bg-white/15 md:h-px md:w-full"
                data-testid="belot-trump-upcard-separator"
              />
            ) : null}
            {state.upcard ? (
              <div className="text-center">
                <p className="mb-1 text-sm font-semibold">Upcard</p>
                <TrumpMarkedCard
                  card={state.upcard}
                  trumpSuit={state.trumpSuit}
                >
                  <PlayingCard card={state.upcard} compact />
                </TrumpMarkedCard>
              </div>
            ) : null}
            {showHandResult && state.lastHandResult ? (
              <div
                className="w-full border-t border-white/15 pt-3 text-center"
                data-testid="belot-hand-result"
              >
                <p className="mb-2 text-sm font-semibold">Hand result</p>
                <div className="grid grid-cols-2 items-center gap-4">
                  {state.players.slice(0, 2).map((player, index) => (
                    <p
                      key={player.playerId}
                      aria-label={
                        index === 0 ? "Left hand result" : "Right hand result"
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
              </div>
            ) : null}
          </div>
        </div>
        {playerPanels[1]}
      </div>

      {state.trumpTurnPlayerId === currentPlayerId ? (
        <div className="mt-4 rounded-md bg-white/10 p-3 text-white">
          <p className="text-sm font-semibold">Choose trump</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.phase === "trump-round-one" ? (
              <Button
                onClick={() => onTrumpDecision({ kind: "accept-upcard" })}
                aria-label={
                  state.upcard
                    ? `Accept ${suitLabels[state.upcard.suit]}`
                    : "Accept upcard"
                }
              >
                <span className="inline-flex items-center gap-2">
                  Accept
                  {state.upcard ? (
                    <SuitImage suit={state.upcard.suit} className="h-7 w-7" />
                  ) : null}
                </span>
              </Button>
            ) : null}
            {state.phase !== "mus" ? (
              <Button onClick={() => onTrumpDecision({ kind: "pass" })}>
                Pass
              </Button>
            ) : null}
            {state.phase === "trump-round-two" || state.phase === "mus"
              ? selectableSuits.map((suit) => (
                  <Button
                    key={suit}
                    onClick={() =>
                      onTrumpDecision({ kind: "choose-suit", suit })
                    }
                    aria-label={`Choose ${suitLabels[suit]}`}
                  >
                    <SuitImage suit={suit} className="h-9 w-9" />
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
          <p className="mb-2 text-sm font-semibold">
            {selectionLogs.length
              ? "Trump selection"
              : (visibleTrick?.label ?? "Current trick")}
          </p>
          {selectionLogs.length ? (
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
          ) : (
            <div className="grid h-[138px] grid-cols-[repeat(2,71px)] items-start justify-center gap-3 overflow-visible">
              {visibleTrick?.cards.map((play) => (
                <div
                  key={`${play.playerId}-${play.card.id}`}
                  className={
                    visibleTrick.strengthByCardId.size &&
                    !visibleTrick.strengthByCardId.get(play.card.id)
                      ? "opacity-45"
                      : ""
                  }
                >
                  <TrumpMarkedCard card={play.card} trumpSuit={state.trumpSuit}>
                    <PlayingCard card={play.card} native />
                  </TrumpMarkedCard>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {showHandResult ? (
        <>
          {winnerPlayer ? (
            <div
              className="mt-4 rounded-md bg-white/10 p-3 text-center text-white"
              data-testid="belot-winner"
            >
              <p className="text-lg font-bold">
                Winner: {winnerPlayer.displayName}
              </p>
              <div className="mt-3">
                <Button onClick={onRestart}>Next game</Button>
              </div>
            </div>
          ) : null}
          <div
            className="mt-4 rounded-md bg-white/10 p-3 text-white"
            data-testid="belot-starting-cards"
          >
            <h3 className="font-bold">Starting cards</h3>
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
                label="Tesla"
                cards={state.unusedCards ?? []}
                trumpSuit={state.trumpSuit}
              />
            </div>
          </div>
        </>
      ) : currentHand.length ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">
            Your hand
            {state.currentTurnPlayerId === currentPlayerId
              ? " · play a legal card"
              : ""}
          </p>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-2">
              {currentHandSuitGroups.map((group) => (
                <div
                  key={group.suit}
                  className="flex flex-wrap gap-2"
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

                    return (
                      <button
                        key={card.id}
                        type="button"
                        className="relative rounded-md disabled:cursor-default disabled:opacity-100"
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
                          <span className="sr-only">Hidden pickup card</span>
                        ) : null}
                        {state.trumpSuit ? (
                          <span className="mt-1 block text-xs text-white/70">
                            {belotCardPoints(card, state.trumpSuit)} pts
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
              {showBonusPreview ? (
                <div
                  className="flex h-[138px] items-center"
                  data-testid="belot-hand-bonus-total"
                >
                  <span className="rounded-full bg-emerald-300 px-3 py-1 text-sm font-bold leading-none text-ink shadow-sm">
                    {bonusPreview.points} bonus pts
                  </span>
                </div>
              ) : null}
            </div>
            {showHiddenPickupPlaceholders ? (
              <div className="ml-auto flex shrink-0 gap-2">
                {[1, 2].map((index) => (
                  <HiddenPickupPlaceholder
                    key={index}
                    index={index}
                    reserveMarkerRow={showBonusPreview}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <Button
          type="button"
          onClick={() => setShowPlayedHands((visible) => !visible)}
        >
          {showPlayedHands ? "Hide details" : "Show details"}
        </Button>
        {showPlayedHands ? (
          <div className="mt-3 rounded-md bg-white/10 p-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]">
              <section className="min-w-0" data-testid="belot-played-tricks">
                <h3 className="text-sm font-semibold">Played tricks</h3>
                <div className="mt-2 space-y-3">
                  {displayedCompletedTricks.length ? (
                    displayedCompletedTricks.map(
                      ({ index, trick }, itemIndex) => (
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
                              Trick {index + 1} ·{" "}
                              {
                                state.players.find(
                                  (player) =>
                                    player.playerId === trick.winnerPlayerId,
                                )?.displayName
                              }
                            </p>
                            <div className="flex flex-wrap gap-3">
                              {trick.cards.map((play) => (
                                <div
                                  key={`${index}-${play.playerId}-${play.card.id}`}
                                  className={
                                    play.playerId === trick.winnerPlayerId
                                      ? ""
                                      : "opacity-45"
                                  }
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
                      ),
                    )
                  ) : (
                    <p className="text-sm text-white/60">
                      No tricks completed yet.
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
        ) : null}
      </div>

      {state.error ? (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
