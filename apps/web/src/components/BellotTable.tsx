import {
  autoSelectBellotDeclarations,
  bellotCardPoints,
  legalBellotCards,
} from "@card-games/game-core";
import type {
  BellotDeclaration,
  BellotPublicState,
  Suit,
} from "@card-games/shared";
import { useEffect, useMemo } from "react";

import { PlayingCard } from "../game/cards";
import { Button } from "./Button";

const suitLabels: Record<Suit, string> = {
  acorns: "Acorns",
  bells: "Bells",
  hearts: "Hearts",
  leaves: "Leaves",
};

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
  const currentHand = currentPlayer?.hand ?? [];
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

  useEffect(() => {
    if (
      state.phase !== "declarations" ||
      !state.trumpSuit ||
      !currentPlayer?.hand ||
      currentPlayer.declarationsSubmitted
    ) {
      return;
    }

    onDeclare(
      autoSelectBellotDeclarations(currentPlayer.hand, state.trumpSuit),
    );
  }, [currentPlayer, onDeclare, state.phase, state.trumpSuit]);

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
          <p className="text-sm text-white/80">
            Status: {state.phase.replaceAll("-", " ")}
            {state.trumpSuit ? ` · Trump: ${suitLabels[state.trumpSuit]}` : ""}
            {state.isMus ? " · Mus" : ""}
          </p>
        </div>
        {state.phase === "hand-complete" ? (
          <Button onClick={onNextHand}>Next hand</Button>
        ) : state.phase === "finished" ? (
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
            {player.publicCards.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {player.publicCards.map((card) => (
                  <PlayingCard key={card.id} card={card} compact />
                ))}
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

      {state.currentTrick.length ? (
        <div className="mt-4 rounded-md bg-white/10 p-3">
          <p className="mb-2 text-sm font-semibold">Current trick</p>
          <div className="flex flex-wrap gap-3">
            {state.currentTrick.map((play) => (
              <div key={`${play.playerId}-${play.card.id}`}>
                <PlayingCard card={play.card} />
              </div>
            ))}
          </div>
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
            {currentHand.map((card) => {
              const playable = legalCardIds.has(card.id);

              return (
                <button
                  key={card.id}
                  type="button"
                  className="rounded-md disabled:opacity-45"
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
