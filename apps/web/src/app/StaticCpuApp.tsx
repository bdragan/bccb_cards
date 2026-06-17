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
    setBelotState(createState());
  }, [createState]);

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
    setBelotState((current) => applyBelotAction(current, action));
    setHasHumanProgress(true);
  }

  function restartGame() {
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
