import {
  autoSelectBellotDeclarations,
  bellotCardPoints,
  compareBellotCards,
  legalBellotCards,
} from "@card-games/game-core";
import type {
  BellotDeclaration,
  BellotPublicState,
  BellotTrickPlay,
  Card,
  Rank,
  Suit,
} from "@card-games/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import { PlayingCard } from "../game/cards";
import { Button } from "./Button";

const suitLabels: Record<Suit, string> = {
  acorns: "Acorns",
  bells: "Bells",
  hearts: "Hearts",
  leaves: "Leaves",
};

const suitOrder: Suit[] = ["acorns", "bells", "hearts", "leaves"];
const rankOrder: Rank[] = ["VII", "VIII", "IX", "X", "U", "O", "K", "A"];
const completedTrickLingerMs = 2_000;

function sortCards(cards: Card[]) {
  return [...cards].sort((left, right) => {
    const suitComparison =
      suitOrder.indexOf(left.suit) - suitOrder.indexOf(right.suit);

    return suitComparison === 0
      ? rankOrder.indexOf(left.rank) - rankOrder.indexOf(right.rank)
      : suitComparison;
  });
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

function sortDeclarations(declarations: BellotDeclaration[]) {
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

function declarationGroupLabel(type: BellotDeclaration["type"]) {
  return type
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function trickStrengthMap(trick: BellotTrickPlay[], trumpSuit?: Suit) {
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

    return compareBellotCards(play.card, winner.card, trumpSuit) > 0
      ? play
      : winner;
  });

  return new Map(trick.map((play) => [play.card.id, play === strongest]));
}

export function BellotTable({
  state,
  currentPlayerId,
  onTrumpDecision,
  onDeclare,
  onPlayCard,
  onNextHand,
  onRestart,
}: {
  state: BellotPublicState;
  currentPlayerId?: string;
  onTrumpDecision: (
    decision:
      | { kind: "pass" }
      | { kind: "accept-upcard" }
      | { kind: "choose-suit"; suit: Suit },
  ) => void;
  onDeclare: (declarations: BellotDeclaration[]) => void;
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
    () => sortCards(currentHand),
    [currentHand],
  );
  const declarationSubmissionKeys = useRef(new Set<string>());
  const [lingeringTrick, setLingeringTrick] = useState<{
    trickNumber: number;
    winnerPlayerId: string;
    cards: BellotTrickPlay[];
  }>();
  const [showPlayedHands, setShowPlayedHands] = useState(false);

  const legalCardIds = useMemo(() => {
    if (
      state.phase !== "trick-play" ||
      state.currentTurnPlayerId !== currentPlayerId ||
      !state.trumpSuit
    ) {
      return new Set<string>();
    }

    return new Set(
      legalBellotCards(currentHand, state.currentTrick, state.trumpSuit).map(
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
      ) as Record<string, BellotDeclaration[]>,
    [state.declarationsByPlayer, state.players],
  );
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
      : undefined;

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
      autoSelectBellotDeclarations(currentPlayer.hand, state.trumpSuit),
    );
  }, [currentPlayer, currentPlayerId, onDeclare, state.phase, state.trumpSuit]);

  const selectableSuits = state.upcard
    ? (Object.keys(suitLabels) as Suit[]).filter(
        (suit) => suit !== state.upcard?.suit,
      )
    : [];

  return (
    <section className="rounded-md bg-felt p-4 text-white shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Bellot</h2>
          <p className="text-sm text-white/80" data-testid="bellot-status">
            Status: {state.phase.replaceAll("-", " ")}
            {state.trumpSuit ? ` · Trump: ${suitLabels[state.trumpSuit]}` : ""}
            {state.isMus ? " · Mus" : ""}
          </p>
        </div>
        {state.phase === "hand-complete" ? (
          <Button onClick={onNextHand}>Next hand</Button>
        ) : state.phase === "finished" ? (
          <Button onClick={onRestart}>New game</Button>
        ) : state.phase === "error" ? (
          <Button onClick={onRestart}>New game</Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {state.players.map((player) => (
          <article key={player.playerId} className="rounded-md bg-white/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{player.displayName}</h3>
              <span className="text-sm text-white/80">
                {player.totalScore} pts · {player.tricksWon} tricks
              </span>
            </div>
            <p className="mt-1 text-xs uppercase text-white/60">
              {state.dealerPlayerId === player.playerId ? "Dealer" : "First"}
              {state.callerPlayerId === player.playerId ? " · Caller" : ""}
            </p>
            {declarationsByPlayer[player.playerId]?.length ? (
              <div className="mt-3 flex flex-wrap gap-3">
                {declarationsByPlayer[player.playerId].map(
                  (declaration, index) => (
                    <div
                      key={`${declaration.type}-${index}`}
                      className="min-w-0"
                    >
                      <p className="mb-1 text-xs font-semibold text-white/70">
                        {declarationGroupLabel(declaration.type)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {sortDeclarationCards(declaration.cards).map((card) => (
                          <div
                            key={card.id}
                            className={
                              playedCardIds.has(card.id) ? "opacity-45" : ""
                            }
                          >
                            <PlayingCard card={card} compact />
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/60">
                {player.handCount} cards in hand
              </p>
            )}
          </article>
        ))}
      </div>

      {state.upcard ? (
        <div className="mt-4 rounded-md bg-white/10 p-3">
          <p className="mb-2 text-sm font-semibold">Upcard</p>
          <PlayingCard card={state.upcard} />
        </div>
      ) : null}

      {state.trumpTurnPlayerId === currentPlayerId ? (
        <div className="mt-4 rounded-md bg-white p-3 text-ink">
          <p className="text-sm font-semibold">Choose trump</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.phase === "trump-round-one" ? (
              <Button
                onClick={() => onTrumpDecision({ kind: "accept-upcard" })}
              >
                Accept {state.upcard ? suitLabels[state.upcard.suit] : "upcard"}
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
                  >
                    {suitLabels[suit]}
                  </Button>
                ))
              : null}
          </div>
        </div>
      ) : null}

      {visibleTrick ? (
        <div className="mt-4 rounded-md bg-white/10 p-3">
          <p className="mb-2 text-sm font-semibold">{visibleTrick.label}</p>
          <div className="flex flex-wrap gap-3">
            {visibleTrick.cards.map((play) => (
              <div
                key={`${play.playerId}-${play.card.id}`}
                className={
                  visibleTrick.strengthByCardId.size &&
                  !visibleTrick.strengthByCardId.get(play.card.id)
                    ? "opacity-45"
                    : ""
                }
              >
                <PlayingCard card={play.card} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {state.completedTricks.length ? (
        <div className="mt-4">
          <Button
            type="button"
            onClick={() => setShowPlayedHands((visible) => !visible)}
          >
            {showPlayedHands ? "Hide played hands" : "Show played hands"}
          </Button>
          {showPlayedHands ? (
            <div className="mt-3 space-y-3 rounded-md bg-white/10 p-3">
              {state.completedTricks.map((trick, index) => (
                <div key={index}>
                  <p className="mb-2 text-sm font-semibold">
                    Hand {index + 1} ·{" "}
                    {
                      state.players.find(
                        (player) => player.playerId === trick.winnerPlayerId,
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
                        <PlayingCard card={play.card} compact />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {currentHand.length ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">
            Your hand
            {state.currentTurnPlayerId === currentPlayerId
              ? " · play a legal card"
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {sortedCurrentHand.map((card) => {
              const playable = legalCardIds.has(card.id);

              return (
                <button
                  key={card.id}
                  type="button"
                  className="rounded-md disabled:opacity-70"
                  data-testid="bellot-hand-card"
                  disabled={
                    state.phase !== "trick-play" ||
                    state.currentTurnPlayerId !== currentPlayerId ||
                    !playable
                  }
                  onClick={() => onPlayCard(card.id)}
                >
                  <PlayingCard card={card} />
                  {state.trumpSuit ? (
                    <span className="mt-1 block text-xs text-white/70">
                      {bellotCardPoints(card, state.trumpSuit)} pts
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {state.lastHandResult ? (
        <div className="mt-4 rounded-md bg-white p-3 text-ink">
          <h3 className="font-bold">Hand score</h3>
          <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
            {state.players.map((player) => (
              <p key={player.playerId}>
                {player.displayName}:{" "}
                {state.lastHandResult?.handScoreByPlayer[player.playerId] ?? 0}
              </p>
            ))}
          </div>
          {state.lastHandResult.callerFell ? (
            <p className="mt-2 text-sm text-red-700">Caller fell.</p>
          ) : null}
        </div>
      ) : null}

      {state.winnerPlayerId ? (
        <div className="mt-4 rounded-md bg-white p-3 text-ink">
          <h3 className="font-bold">Winner</h3>
          <p className="text-sm">
            {
              state.players.find(
                (player) => player.playerId === state.winnerPlayerId,
              )?.displayName
            }
          </p>
        </div>
      ) : null}

      {state.error ? (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
