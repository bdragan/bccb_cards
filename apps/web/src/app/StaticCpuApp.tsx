import {
  applyBelotAction,
  type BelotAction,
  type BelotCpuOptions,
  type BelotState,
  createBelotInitialState,
  defaultBelotCpuMaxSearchPlies,
  getBelotPublicState,
} from "@card-games/game-core";
import type { BelotDeclaration, Suit } from "@card-games/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { trackEvent } from "../analytics/posthog";
import { BelotTable } from "../components/BelotTable";
import { BelotAssetsGate } from "../game/BelotAssetsGate";
import { useI18n } from "../i18n";
import type {
  BelotCpuWorkerRequest,
  BelotCpuWorkerResponse,
} from "../workers/belot-cpu.worker";

const humanPlayerId = "offline-human";
const cpuPlayerId = "offline-cpu";
const cpuDecisionDelayMs = 250;
const cpuPlayDelayMs = 450;
const cpuCompletedTrickLeadDelayMs = 2_000;

function playerKind(playerId: string | undefined) {
  if (playerId === humanPlayerId) {
    return "human";
  }

  if (playerId === cpuPlayerId) {
    return "cpu";
  }

  return undefined;
}

function elapsedSeconds(startedAt: number) {
  return Math.round((Date.now() - startedAt) / 1000);
}

function cpuActionDelay(state: BelotState) {
  if (
    state.phase !== "trick-play" ||
    state.currentTurnPlayerId !== cpuPlayerId
  ) {
    return cpuDecisionDelayMs;
  }

  const isLeadingAfterCompletedTrick =
    state.currentTrick.length === 0 && state.completedTricks.length > 0;

  return isLeadingAfterCompletedTrick
    ? cpuCompletedTrickLeadDelayMs
    : cpuPlayDelayMs;
}

function isCpuTurn(state: BelotState) {
  if (state.trumpTurnPlayerId === cpuPlayerId) {
    return true;
  }

  if (
    state.phase === "declarations" &&
    state.trumpSuit &&
    !Object.prototype.hasOwnProperty.call(
      state.declarationsByPlayer,
      cpuPlayerId,
    )
  ) {
    return true;
  }

  return (
    state.phase === "trick-play" && state.currentTurnPlayerId === cpuPlayerId
  );
}

export function shouldConfirmStaticCpuLeave(
  hasHumanProgress: boolean,
  state: Pick<BelotState, "winnerPlayerId">,
) {
  return hasHumanProgress && !state.winnerPlayerId;
}

export function StaticCpuApp() {
  const { messages } = useI18n();
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingStateRef = useRef<BelotState | null>(null);
  const gameStartedAtRef = useRef(Date.now());
  const trackedHandCountRef = useRef(0);
  const firstCardPlayTrackedRef = useRef(false);
  const gameCompletedTrackedRef = useRef(false);
  const trackedErrorRef = useRef<string | undefined>(undefined);
  const [hasHumanProgress, setHasHumanProgress] = useState(false);

  const createState = useCallback(() => {
    let nextState = createBelotInitialState([
      { playerId: humanPlayerId, displayName: messages.offlineYou },
      { playerId: cpuPlayerId, displayName: messages.cpu },
    ]);

    nextState = applyBelotAction(nextState, {
      type: "set-ready",
      playerId: humanPlayerId,
      ready: true,
    });
    nextState = applyBelotAction(nextState, {
      type: "set-ready",
      playerId: cpuPlayerId,
      ready: true,
    });

    return nextState;
  }, [messages.cpu, messages.offlineYou]);

  const [belotState, setBelotState] = useState<BelotState>(() => createState());
  const shouldConfirmBeforeLeaving = shouldConfirmStaticCpuLeave(
    hasHumanProgress,
    belotState,
  );

  useEffect(() => {
    trackEvent("game_loaded");
  }, []);

  useEffect(() => {
    setBelotState(createState());
  }, [createState]);

  useEffect(() => {
    const handCount =
      belotState.handResults?.length ?? (belotState.lastHandResult ? 1 : 0);

    if (handCount > trackedHandCountRef.current) {
      const lastHandResult =
        belotState.handResults?.at(-1) ?? belotState.lastHandResult;

      trackEvent("hand_completed", {
        hand_number: handCount,
        phase: belotState.phase,
        duration_seconds: elapsedSeconds(gameStartedAtRef.current),
        trump_suit: lastHandResult?.trumpSuit,
        caller: playerKind(lastHandResult?.callerPlayerId),
        hand_winner: playerKind(lastHandResult?.lastTrickWinnerPlayerId),
        human_hand_score:
          lastHandResult?.handScoreByPlayer[humanPlayerId] ?? 0,
        cpu_hand_score: lastHandResult?.handScoreByPlayer[cpuPlayerId] ?? 0,
        human_total_score:
          belotState.players.find((player) => player.playerId === humanPlayerId)
            ?.totalScore ?? 0,
        cpu_total_score:
          belotState.players.find((player) => player.playerId === cpuPlayerId)
            ?.totalScore ?? 0,
      });

      trackedHandCountRef.current = handCount;
    }

    if (
      belotState.phase === "finished" &&
      belotState.winnerPlayerId &&
      !gameCompletedTrackedRef.current
    ) {
      trackEvent("game_completed", {
        duration_seconds: elapsedSeconds(gameStartedAtRef.current),
        hand_count: handCount,
        winner: playerKind(belotState.winnerPlayerId),
        human_total_score:
          belotState.players.find((player) => player.playerId === humanPlayerId)
            ?.totalScore ?? 0,
        cpu_total_score:
          belotState.players.find((player) => player.playerId === cpuPlayerId)
            ?.totalScore ?? 0,
      });

      gameCompletedTrackedRef.current = true;
    }

    if (belotState.phase === "error" && belotState.error !== trackedErrorRef.current) {
      trackEvent("game_error", {
        phase: belotState.phase,
        error: belotState.error,
        duration_seconds: elapsedSeconds(gameStartedAtRef.current),
      });
      trackedErrorRef.current = belotState.error;
    }
  }, [belotState]);

  useEffect(() => {
    if (!shouldConfirmBeforeLeaving) {
      return;
    }

    function confirmBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", confirmBeforeLeaving);

    return () => {
      window.removeEventListener("beforeunload", confirmBeforeLeaving);
    };
  }, [shouldConfirmBeforeLeaving]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/belot-cpu.worker.ts", import.meta.url),
      { type: "module" },
    );

    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<BelotCpuWorkerResponse>) => {
      const { requestId, action, error: workerError } = event.data;

      if (requestId !== requestIdRef.current) {
        return;
      }

      const requestedState = pendingStateRef.current;
      pendingStateRef.current = null;

      if (!requestedState) {
        return;
      }

      setBelotState((current) => {
        if (current !== requestedState) {
          return current;
        }

        if (workerError) {
          return {
            ...current,
            phase: "error",
            error: workerError,
          };
        }

        return action ? applyBelotAction(current, action) : current;
      });
    };

    worker.onerror = (event) => {
      const requestedState = pendingStateRef.current;
      pendingStateRef.current = null;

      if (!requestedState) {
        return;
      }

      setBelotState((current) =>
        current === requestedState
          ? {
              ...current,
              phase: "error",
              error: event.message || messages.cpuActionFailed,
            }
          : current,
      );
    };

    return () => {
      workerRef.current = null;
      pendingStateRef.current = null;
      requestIdRef.current += 1;
      worker.terminate();
    };
  }, [messages.cpuActionFailed]);

  useEffect(() => {
    const cpuOptions: BelotCpuOptions = {
      maxSearchPlies: defaultBelotCpuMaxSearchPlies,
      monteCarloSamples: 64,
    };

    if (!isCpuTurn(belotState)) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const worker = workerRef.current;

      if (!worker) {
        setBelotState((current) =>
          current === belotState
            ? {
                ...current,
                phase: "error",
                error: messages.cpuWorkerUnavailable,
              }
            : current,
        );
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      pendingStateRef.current = belotState;
      worker.postMessage({
        requestId,
        state: belotState,
        cpuPlayerId,
        options: cpuOptions,
      } satisfies BelotCpuWorkerRequest);
    }, cpuActionDelay(belotState));

    return () => window.clearTimeout(timeout);
  }, [belotState, messages.cpuWorkerUnavailable]);

  const publicState = useMemo(
    () => getBelotPublicState(belotState, humanPlayerId),
    [belotState],
  );

  function applyAction(action: BelotAction) {
    if (!hasHumanProgress) {
      trackEvent("game_started", {
        first_action: action.type,
        phase: belotState.phase,
      });
    }

    if (
      action.type === "play-card" &&
      action.playerId === humanPlayerId &&
      !firstCardPlayTrackedRef.current
    ) {
      trackEvent("first_card_played", {
        completed_tricks: belotState.completedTricks.length,
        hand_number:
          (belotState.handResults?.length ??
            (belotState.lastHandResult ? 1 : 0)) + 1,
      });
      firstCardPlayTrackedRef.current = true;
    }

    setBelotState((current) => applyBelotAction(current, action));
    setHasHumanProgress(true);
  }

  function restartGame() {
    trackEvent("new_game_started", {
      previous_duration_seconds: elapsedSeconds(gameStartedAtRef.current),
      previous_hand_count:
        belotState.handResults?.length ?? (belotState.lastHandResult ? 1 : 0),
      previous_winner: playerKind(belotState.winnerPlayerId),
    });

    gameStartedAtRef.current = Date.now();
    trackedHandCountRef.current = 0;
    firstCardPlayTrackedRef.current = false;
    gameCompletedTrackedRef.current = false;
    trackedErrorRef.current = undefined;
    setHasHumanProgress(false);
    setBelotState(createState());
  }

  function applyTrumpDecision(
    decision:
      | { kind: "pass" }
      | { kind: "accept-upcard" }
      | { kind: "choose-suit"; suit: Suit },
  ) {
    if (decision.kind === "pass") {
      applyAction({ type: "trump-pass", playerId: humanPlayerId });
    } else if (decision.kind === "accept-upcard") {
      applyAction({ type: "trump-accept-upcard", playerId: humanPlayerId });
    } else {
      applyAction({
        type: "trump-choose-suit",
        playerId: humanPlayerId,
        suit: decision.suit,
      });
    }
  }

  function submitDeclarations(declarations: BelotDeclaration[]) {
    applyAction({
      type: "declare",
      playerId: humanPlayerId,
      declarations,
    });
  }

  return (
    <main className="app-background min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <BelotAssetsGate>
          <BelotTable
            state={publicState}
            currentPlayerId={humanPlayerId}
            onTrumpDecision={applyTrumpDecision}
            onDeclare={submitDeclarations}
            onPlayCard={(cardId) =>
              applyAction({
                type: "play-card",
                playerId: humanPlayerId,
                cardId,
              })
            }
            onNextHand={() => applyAction({ type: "next-hand" })}
            onRestart={restartGame}
          />
        </BelotAssetsGate>
      </div>
    </main>
  );
}
