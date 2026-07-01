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
import { Button } from "../components/Button";
import { LanguageToggle } from "../components/LanguageToggle";
import { TopMenu } from "../components/TopMenu";
import { BelotAssetsGate } from "../game/BelotAssetsGate";
import { type Messages, useI18n } from "../i18n";
import {
  applyCpuLevelResult,
  type CpuLevelProgress,
  isGrandmasterLevel,
  readCpuLevelProgress,
  writeCpuLevelProgress,
} from "../progress/cpu-levels";
import type {
  BelotCpuWorkerRequest,
  BelotCpuWorkerResponse,
} from "../workers/belot-cpu.worker";
import { isStaticCpuHandDebugBuild } from "./build-mode";

const humanPlayerId = "offline-human";
const cpuPlayerId = "offline-cpu";
const cpuDecisionDelayMs = 250;
const cpuPlayDelayMs = 450;
const cpuCompletedTrickLeadDelayMs = 2_000;
export const staticCpuStorageKey = "card-games-static-cpu-state-v1";

type StaticCpuStoredGame = {
  version: 1;
  state: BelotState;
  hasHumanProgress: boolean;
  gameStartedAt: number;
  trackedHandCount: number;
  firstCardPlayTracked: boolean;
  gameCompletedTracked: boolean;
  playerProgressUpdated?: boolean;
  trackedError?: string;
};

const belotPhases = new Set<BelotState["phase"]>([
  "waiting-for-players",
  "ready-check",
  "trump-round-one",
  "trump-round-two",
  "mus",
  "declarations",
  "trick-play",
  "hand-complete",
  "finished",
  "error",
]);

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

function visibleCpuLevelRank(progress: CpuLevelProgress, messages: Messages) {
  const levelName = messages.cpuLevelNames[progress.level];

  return isGrandmasterLevel(progress.level)
    ? `${levelName} ${progress.points}`
    : levelName;
}

function RankPopover({ visibleRank }: { visibleRank: string }) {
  const { messages } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const label = messages.currentRank(visibleRank);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative max-w-[calc(100vw-7rem)]">
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        className="block max-w-full truncate rounded-full border border-emerald-200/45 bg-felt/95 px-3 py-1.5 text-sm font-bold leading-none text-emerald-50 shadow-sm shadow-ink/20 transition hover:border-emerald-100 hover:bg-[#17613f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-100"
        data-testid="player-current-rank"
        onClick={() => setOpen((current) => !current)}
      >
        {visibleRank}
      </button>
      {open ? (
        <div
          className="pointer-events-auto absolute left-0 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-md border border-emerald-200/50 bg-[#f6fbf8] p-3 text-ink shadow-lg shadow-ink/20"
          data-testid="player-current-rank-popover"
        >
          <p className="text-sm font-semibold">{label}</p>
        </div>
      ) : null}
    </div>
  );
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

function isStoredBelotStateShape(
  state: Partial<BelotState> | undefined,
): state is BelotState {
  return Boolean(
    state?.gameId === "belot" &&
    state.phase &&
    belotPhases.has(state.phase) &&
    Array.isArray(state.players) &&
    state.players.length === 2 &&
    state.players.every((player) => typeof player.playerId === "string") &&
    Array.isArray(state.currentTrick) &&
    Array.isArray(state.completedTricks) &&
    state.declarationsByPlayer &&
    typeof state.declarationsByPlayer === "object" &&
    state.publicCardsByPlayer &&
    typeof state.publicCardsByPlayer === "object",
  );
}

function isStoredStaticCpuGame(value: unknown): value is StaticCpuStoredGame {
  if (!value || typeof value !== "object") {
    return false;
  }

  const stored = value as Partial<StaticCpuStoredGame>;
  const state = stored.state as Partial<BelotState> | undefined;

  return (
    stored.version === 1 &&
    typeof stored.hasHumanProgress === "boolean" &&
    typeof stored.gameStartedAt === "number" &&
    typeof stored.trackedHandCount === "number" &&
    typeof stored.firstCardPlayTracked === "boolean" &&
    typeof stored.gameCompletedTracked === "boolean" &&
    isStoredBelotStateShape(state)
  );
}

function readStoredStaticCpuGame() {
  try {
    const stored = window.localStorage.getItem(staticCpuStorageKey);

    if (!stored) {
      return undefined;
    }

    const parsed: unknown = JSON.parse(stored);

    return isStoredStaticCpuGame(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredStaticCpuGame(stored: StaticCpuStoredGame) {
  try {
    window.localStorage.setItem(staticCpuStorageKey, JSON.stringify(stored));
  } catch {
    // Local storage can be unavailable or full. The game should remain playable.
  }
}

function shouldStartNewGameAfterLoad(storedGame: StaticCpuStoredGame) {
  return storedGame.state.phase === "finished";
}

function shouldStartNextHandAfterLoad(storedGame: StaticCpuStoredGame) {
  return storedGame.state.phase === "hand-complete";
}

function withStaticCpuPlayerNames(state: BelotState, messages: Messages) {
  return {
    ...state,
    players: state.players.map((player) => {
      if (player.playerId === humanPlayerId) {
        return { ...player, displayName: messages.offlineYou };
      }

      if (player.playerId === cpuPlayerId) {
        return { ...player, displayName: messages.cpu };
      }

      return player;
    }),
  };
}

function loadedFinishedGameOutcome(
  storedGame: StaticCpuStoredGame | undefined,
) {
  if (
    !storedGame ||
    storedGame.state.phase !== "finished" ||
    !storedGame.state.winnerPlayerId ||
    storedGame.playerProgressUpdated
  ) {
    return undefined;
  }

  return storedGame.state.winnerPlayerId === humanPlayerId ? "win" : "loss";
}

function markLoadedFinishedGameProgressUpdated(
  storedGame: StaticCpuStoredGame | undefined,
) {
  if (!storedGame || storedGame.state.phase !== "finished") {
    return false;
  }

  const currentStoredGame = readStoredStaticCpuGame();

  if (
    !currentStoredGame ||
    currentStoredGame.state.phase !== "finished" ||
    currentStoredGame.playerProgressUpdated ||
    currentStoredGame.state.createdAt !== storedGame.state.createdAt ||
    currentStoredGame.state.finishedAt !== storedGame.state.finishedAt
  ) {
    return false;
  }

  writeStoredStaticCpuGame({
    ...currentStoredGame,
    playerProgressUpdated: true,
  });

  return true;
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
  const playerProgressUpdatedRef = useRef(false);
  const trackedErrorRef = useRef<string | undefined>(undefined);

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

  const [storedGame] = useState(() => readStoredStaticCpuGame());
  const [levelProgress, setLevelProgress] = useState(() =>
    readCpuLevelProgress(),
  );
  const [resignConfirmationOpen, setResignConfirmationOpen] = useState(false);
  const [hasHumanProgress, setHasHumanProgress] = useState(() =>
    storedGame && shouldStartNewGameAfterLoad(storedGame)
      ? false
      : (storedGame?.hasHumanProgress ?? false),
  );
  const [belotState, setBelotState] = useState<BelotState>(() => {
    if (!storedGame) {
      return createState();
    }

    gameStartedAtRef.current = storedGame.gameStartedAt;
    trackedHandCountRef.current = storedGame.trackedHandCount;
    firstCardPlayTrackedRef.current = storedGame.firstCardPlayTracked;
    gameCompletedTrackedRef.current = storedGame.gameCompletedTracked;
    playerProgressUpdatedRef.current =
      storedGame.playerProgressUpdated ?? false;
    trackedErrorRef.current = storedGame.trackedError;

    const storedState = withStaticCpuPlayerNames(storedGame.state, messages);

    if (shouldStartNextHandAfterLoad(storedGame)) {
      return applyBelotAction(storedState, { type: "next-hand" });
    }

    if (shouldStartNewGameAfterLoad(storedGame)) {
      gameStartedAtRef.current = Date.now();
      trackedHandCountRef.current = 0;
      firstCardPlayTrackedRef.current = false;
      gameCompletedTrackedRef.current = false;
      playerProgressUpdatedRef.current = false;
      trackedErrorRef.current = undefined;

      return createState();
    }

    return storedState;
  });

  useEffect(() => {
    trackEvent("game_loaded");
  }, []);

  useEffect(() => {
    const restoredFinishedGameOutcome = loadedFinishedGameOutcome(storedGame);

    if (
      !restoredFinishedGameOutcome ||
      !markLoadedFinishedGameProgressUpdated(storedGame)
    ) {
      return;
    }

    const nextProgress = applyCpuLevelResult(
      readCpuLevelProgress(),
      restoredFinishedGameOutcome,
    );

    writeCpuLevelProgress(nextProgress);
    setLevelProgress(nextProgress);
  }, [storedGame]);

  useEffect(() => {
    setBelotState((current) => withStaticCpuPlayerNames(current, messages));
  }, [messages]);

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
        human_hand_score: lastHandResult?.handScoreByPlayer[humanPlayerId] ?? 0,
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

    if (
      belotState.phase === "finished" &&
      belotState.winnerPlayerId &&
      !playerProgressUpdatedRef.current
    ) {
      playerProgressUpdatedRef.current = true;
      setLevelProgress((current) => {
        const nextProgress = applyCpuLevelResult(
          current,
          belotState.winnerPlayerId === humanPlayerId ? "win" : "loss",
        );

        writeCpuLevelProgress(nextProgress);

        return nextProgress;
      });
    }

    if (
      belotState.phase === "error" &&
      belotState.error !== trackedErrorRef.current
    ) {
      trackEvent("game_error", {
        phase: belotState.phase,
        error: belotState.error,
        duration_seconds: elapsedSeconds(gameStartedAtRef.current),
      });
      trackedErrorRef.current = belotState.error;
    }
  }, [belotState]);

  useEffect(() => {
    writeStoredStaticCpuGame({
      version: 1,
      state: belotState,
      hasHumanProgress,
      gameStartedAt: gameStartedAtRef.current,
      trackedHandCount: trackedHandCountRef.current,
      firstCardPlayTracked: firstCardPlayTrackedRef.current,
      gameCompletedTracked: gameCompletedTrackedRef.current,
      playerProgressUpdated: playerProgressUpdatedRef.current,
      trackedError: trackedErrorRef.current,
    });
  }, [belotState, hasHumanProgress]);

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
  const debugCpuHand = isStaticCpuHandDebugBuild
    ? belotState.players.find((player) => player.playerId === cpuPlayerId)
    : undefined;

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
    playerProgressUpdatedRef.current = false;
    trackedErrorRef.current = undefined;
    setResignConfirmationOpen(false);
    setHasHumanProgress(false);
    setBelotState(createState());
  }

  function resignGame() {
    trackEvent("game_resigned", {
      duration_seconds: elapsedSeconds(gameStartedAtRef.current),
      hand_count:
        belotState.handResults?.length ?? (belotState.lastHandResult ? 1 : 0),
    });

    pendingStateRef.current = null;
    requestIdRef.current += 1;
    gameCompletedTrackedRef.current = true;
    setResignConfirmationOpen(false);
    setHasHumanProgress(true);
    setBelotState((current) => ({
      ...current,
      phase: "finished",
      winnerPlayerId: cpuPlayerId,
      finishedAt: new Date().toISOString(),
      currentTurnPlayerId: undefined,
      trumpTurnPlayerId: undefined,
    }));
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

  const visibleRank = visibleCpuLevelRank(levelProgress, messages);
  const topControls = (
    <TopMenu align="split" leading={<RankPopover visibleRank={visibleRank} />}>
      <LanguageToggle />
      <Button
        type="button"
        onClick={() =>
          setResignConfirmationOpen(belotState.phase !== "finished")
        }
      >
        {messages.resignGame}
      </Button>
    </TopMenu>
  );

  return (
    <main className="app-background min-h-screen">
      <div className="mx-auto max-w-6xl px-4 pb-6 pt-0">
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
            levelProgress={levelProgress}
            topControls={topControls}
            skipInitialCompletedTrickAnimation={Boolean(storedGame)}
            resignConfirmation={
              resignConfirmationOpen
                ? {
                    onConfirm: resignGame,
                    onCancel: () => setResignConfirmationOpen(false),
                  }
                : undefined
            }
            debugHand={
              debugCpuHand
                ? {
                    label: messages.cpuDebugHand,
                    cards: debugCpuHand.hand,
                    pickupCardIds: debugCpuHand.pickupCardIds,
                  }
                : undefined
            }
          />
        </BelotAssetsGate>
      </div>
    </main>
  );
}
