import {
  applyBelotAction,
  type BelotAction,
  type BelotCpuOptions,
  type BelotState,
  createBelotInitialState,
  defaultBelotCpuMaxSearchPlies,
  getBelotPublicState,
} from "@card-games/game-core";
import type {
  BelotDeclaration,
  BelotPublicState,
  GamePublicState,
  RoomPublicState,
  Suit,
} from "@card-games/shared";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "../api/client";
import { BelotTable } from "../components/BelotTable";
import { Button } from "../components/Button";
import { LanguageToggle } from "../components/LanguageToggle";
import { Lobby } from "../components/Lobby";
import { TopMenu } from "../components/TopMenu";
import { BelotAssetsGate } from "../game/BelotAssetsGate";
import { useI18n } from "../i18n";
import {
  applyCpuLevelResult,
  readCpuLevelProgress,
  writeCpuLevelProgress,
} from "../progress/cpu-levels";
import { createGameSocket, type GameSocket } from "../socket/game-socket";
import { useAuthStore } from "../stores/auth-store";
import type {
  BelotCpuWorkerRequest,
  BelotCpuWorkerResponse,
} from "../workers/belot-cpu.worker";

const offlineCpuPlayerId = "offline-cpu";
const offlineCpuDecisionDelayMs = 250;
const offlineCpuPlayDelayMs = 450;
const offlineCpuCompletedTrickLeadDelayMs = 2_000;

function offlineCpuActionDelay(state: BelotState) {
  if (
    state.phase !== "trick-play" ||
    state.currentTurnPlayerId !== offlineCpuPlayerId
  ) {
    return offlineCpuDecisionDelayMs;
  }

  const isLeadingAfterCompletedTrick =
    state.currentTrick.length === 0 && state.completedTricks.length > 0;

  return isLeadingAfterCompletedTrick
    ? offlineCpuCompletedTrickLeadDelayMs
    : offlineCpuPlayDelayMs;
}

function isOfflineCpuTurn(state: BelotState) {
  if (state.trumpTurnPlayerId === offlineCpuPlayerId) {
    return true;
  }

  if (
    state.phase === "declarations" &&
    state.trumpSuit &&
    !Object.prototype.hasOwnProperty.call(
      state.declarationsByPlayer,
      offlineCpuPlayerId,
    )
  ) {
    return true;
  }

  return (
    state.phase === "trick-play" &&
    state.currentTurnPlayerId === offlineCpuPlayerId
  );
}

export function Dashboard({ onLogin }: { onLogin?: () => void }) {
  const { messages } = useI18n();
  const { token, user, logout } = useAuthStore();
  const [matches, setMatches] = useState<unknown[]>([]);
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<RoomPublicState>();
  const [gameState, setGameState] = useState<GamePublicState>();
  const [offlineBelotState, setOfflineBelotState] = useState<BelotState>();
  const [levelProgress, setLevelProgress] = useState(() =>
    readCpuLevelProgress(),
  );
  const [error, setError] = useState<string>();
  const [socket, setSocket] = useState<GameSocket>();
  const offlineCpuWorkerRef = useRef<Worker | null>(null);
  const offlineCpuRequestIdRef = useRef(0);
  const offlineCpuPendingStateRef = useRef<BelotState | null>(null);
  const autoStartedOfflineBelotRef = useRef(false);
  const levelProgressUpdatedGameRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!token) {
      return;
    }

    void api
      .matches(token)
      .then(setMatches)
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const nextSocket = createGameSocket(token);
    nextSocket.on("room:state", setRoom);
    nextSocket.on("game:state", setGameState);
    nextSocket.on("game:result", () => {
      void api
        .matches(token)
        .then(setMatches)
        .catch(() => undefined);
    });
    nextSocket.on("room:error", (payload) => setError(payload.message));
    setSocket(nextSocket);

    return () => {
      nextSocket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/belot-cpu.worker.ts", import.meta.url),
      { type: "module" },
    );

    offlineCpuWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<BelotCpuWorkerResponse>) => {
      const { requestId, action, error: workerError } = event.data;

      if (requestId !== offlineCpuRequestIdRef.current) {
        return;
      }

      const requestedState = offlineCpuPendingStateRef.current;
      offlineCpuPendingStateRef.current = null;

      if (!requestedState) {
        return;
      }

      setOfflineBelotState((current) => {
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
      const requestedState = offlineCpuPendingStateRef.current;
      offlineCpuPendingStateRef.current = null;

      if (!requestedState) {
        return;
      }

      setOfflineBelotState((current) =>
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
      offlineCpuWorkerRef.current = null;
      offlineCpuPendingStateRef.current = null;
      offlineCpuRequestIdRef.current += 1;
      worker.terminate();
    };
  }, [messages.cpuActionFailed]);

  const inLobby =
    room &&
    (room.phase === "waiting-for-players" || room.phase === "ready-check");
  const matchCount = useMemo(() => matches.length, [matches]);
  const activeBelotGame =
    Boolean(offlineBelotState) || (gameState?.gameId === "belot" && !inLobby);
  const offlineHumanPlayerId =
    offlineBelotState?.players.find(
      (player) => player.playerId !== offlineCpuPlayerId,
    )?.playerId ?? user?.id;
  const offlineBelotPublicState = useMemo<BelotPublicState | undefined>(
    () =>
      offlineBelotState && offlineHumanPlayerId
        ? getBelotPublicState(offlineBelotState, offlineHumanPlayerId)
        : undefined,
    [offlineBelotState, offlineHumanPlayerId],
  );

  useEffect(() => {
    if (!offlineBelotState) {
      return;
    }

    const cpuOptions: BelotCpuOptions = {
      maxSearchPlies: defaultBelotCpuMaxSearchPlies,
      monteCarloSamples: 64,
    };

    if (!isOfflineCpuTurn(offlineBelotState)) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const worker = offlineCpuWorkerRef.current;

      if (!worker) {
        setOfflineBelotState((current) =>
          current === offlineBelotState
            ? {
                ...current,
                phase: "error",
                error: messages.cpuWorkerUnavailable,
              }
            : current,
        );
        return;
      }

      const requestId = offlineCpuRequestIdRef.current + 1;
      offlineCpuRequestIdRef.current = requestId;
      offlineCpuPendingStateRef.current = offlineBelotState;
      worker.postMessage({
        requestId,
        state: offlineBelotState,
        cpuPlayerId: offlineCpuPlayerId,
        options: cpuOptions,
      } satisfies BelotCpuWorkerRequest);
    }, offlineCpuActionDelay(offlineBelotState));

    return () => window.clearTimeout(timeout);
  }, [messages.cpuWorkerUnavailable, offlineBelotState]);

  useEffect(() => {
    if (
      !offlineBelotState ||
      !offlineHumanPlayerId ||
      offlineBelotState.phase !== "finished" ||
      !offlineBelotState.winnerPlayerId
    ) {
      return;
    }

    const gameKey = `${offlineBelotState.createdAt}:${
      offlineBelotState.finishedAt ?? "finished"
    }`;

    if (levelProgressUpdatedGameRef.current === gameKey) {
      return;
    }

    levelProgressUpdatedGameRef.current = gameKey;
    setLevelProgress((current) => {
      const nextProgress = applyCpuLevelResult(
        current,
        offlineBelotState.winnerPlayerId === offlineHumanPlayerId
          ? "win"
          : "loss",
      );

      writeCpuLevelProgress(nextProgress);

      return nextProgress;
    });
  }, [offlineBelotState, offlineHumanPlayerId]);

  function createRoom() {
    setOfflineBelotState(undefined);
    socket?.emit("room:create", { gameId: "belot" }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
      }
    });
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    setOfflineBelotState(undefined);
    socket?.emit("room:join", { roomCode }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
      }
    });
  }

  const createOfflineBelotState = useCallback(() => {
    const humanPlayerId = user?.id ?? "offline-human";
    let nextState = createBelotInitialState([
      {
        playerId: humanPlayerId,
        displayName: user?.displayName ?? messages.offlineYou,
      },
      { playerId: offlineCpuPlayerId, displayName: messages.cpu },
    ]);

    nextState = applyBelotAction(nextState, {
      type: "set-ready",
      playerId: humanPlayerId,
      ready: true,
    });
    nextState = applyBelotAction(nextState, {
      type: "set-ready",
      playerId: offlineCpuPlayerId,
      ready: true,
    });

    return nextState;
  }, [messages.cpu, messages.offlineYou, user?.displayName, user?.id]);

  const startOfflineBelot = useCallback(() => {
    setRoom(undefined);
    setGameState(undefined);
    setError(undefined);
    levelProgressUpdatedGameRef.current = undefined;
    setOfflineBelotState(createOfflineBelotState());
  }, [createOfflineBelotState]);

  useEffect(() => {
    if (autoStartedOfflineBelotRef.current || activeBelotGame || room) {
      return;
    }

    autoStartedOfflineBelotRef.current = true;
    startOfflineBelot();
  }, [activeBelotGame, room, startOfflineBelot]);

  function applyOfflineBelotAction(action: BelotAction) {
    setOfflineBelotState((current) =>
      current ? applyBelotAction(current, action) : current,
    );
  }

  function applyOfflineTrumpDecision(
    decision:
      | { kind: "pass" }
      | { kind: "accept-upcard" }
      | { kind: "choose-suit"; suit: Suit },
  ) {
    if (!offlineHumanPlayerId) {
      return;
    }

    if (decision.kind === "pass") {
      applyOfflineBelotAction({
        type: "trump-pass",
        playerId: offlineHumanPlayerId,
      });
    } else if (decision.kind === "accept-upcard") {
      applyOfflineBelotAction({
        type: "trump-accept-upcard",
        playerId: offlineHumanPlayerId,
      });
    } else {
      applyOfflineBelotAction({
        type: "trump-choose-suit",
        playerId: offlineHumanPlayerId,
        suit: decision.suit,
      });
    }
  }

  function submitOfflineDeclarations(declarations: BelotDeclaration[]) {
    if (!offlineHumanPlayerId) {
      return;
    }

    applyOfflineBelotAction({
      type: "declare",
      playerId: offlineHumanPlayerId,
      declarations,
    });
  }

  return (
    <main className="app-background min-h-screen">
      <TopMenu
        title={messages.appTitle}
        subtitle={user?.displayName ?? messages.offlineYou}
      >
        <LanguageToggle />
        {offlineBelotState ? (
          <Button type="button" onClick={() => setOfflineBelotState(undefined)}>
            {messages.leaveMatch}
          </Button>
        ) : null}
        {token ? (
          <Button type="button" onClick={logout}>
            {messages.logout}
          </Button>
        ) : (
          <Button type="button" onClick={onLogin}>
            {messages.login}
          </Button>
        )}
      </TopMenu>

      <div
        className={`mx-auto grid max-w-6xl gap-5 px-4 py-6 ${
          activeBelotGame ? "" : "lg:grid-cols-[1fr_340px]"
        }`}
      >
        <div className="space-y-5">
          {activeBelotGame ? null : (
            <>
              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold">{messages.room}</h2>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button type="button" onClick={createRoom} disabled={!socket}>
                    {messages.createRoom}
                  </Button>
                  <Button type="button" onClick={startOfflineBelot}>
                    {messages.playBelotVsCpu}
                  </Button>
                  <form
                    onSubmit={joinRoom}
                    className="flex min-w-0 flex-1 gap-2"
                  >
                    <input
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 uppercase"
                      placeholder={messages.roomCode}
                      value={roomCode}
                      onChange={(event) => setRoomCode(event.target.value)}
                    />
                    <Button
                      type="submit"
                      disabled={!socket || roomCode.length < 4}
                    >
                      {messages.join}
                    </Button>
                  </form>
                </div>
                {error ? (
                  <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </p>
                ) : null}
              </section>
            </>
          )}

          {room && inLobby ? (
            <Lobby
              room={room}
              currentPlayerId={user?.id}
              onReady={(ready) =>
                socket?.emit(
                  "player:ready",
                  { roomId: room.id, ready },
                  () => undefined,
                )
              }
            />
          ) : null}

          {offlineBelotPublicState ? (
            <BelotAssetsGate>
              <BelotTable
                state={offlineBelotPublicState}
                currentPlayerId={offlineHumanPlayerId}
                onTrumpDecision={applyOfflineTrumpDecision}
                onDeclare={submitOfflineDeclarations}
                onPlayCard={(cardId) =>
                  offlineHumanPlayerId &&
                  applyOfflineBelotAction({
                    type: "play-card",
                    playerId: offlineHumanPlayerId,
                    cardId,
                  })
                }
                onNextHand={() =>
                  applyOfflineBelotAction({ type: "next-hand" })
                }
                onRestart={() => {
                  levelProgressUpdatedGameRef.current = undefined;
                  setOfflineBelotState(createOfflineBelotState());
                }}
                levelProgress={
                  offlineBelotPublicState.phase === "finished"
                    ? levelProgress
                    : undefined
                }
              />
            </BelotAssetsGate>
          ) : gameState && !inLobby && gameState.gameId === "belot" ? (
            <BelotAssetsGate>
              <BelotTable
                state={gameState}
                currentPlayerId={user?.id}
                onTrumpDecision={(decision) =>
                  room &&
                  socket?.emit(
                    "belot:trump-decision",
                    { roomId: room.id, ...decision },
                    () => undefined,
                  )
                }
                onDeclare={(declarations) =>
                  room &&
                  socket?.emit(
                    "belot:declare",
                    { roomId: room.id, declarations },
                    () => undefined,
                  )
                }
                onPlayCard={(cardId) =>
                  room &&
                  socket?.emit(
                    "belot:play-card",
                    { roomId: room.id, cardId },
                    () => undefined,
                  )
                }
                onNextHand={() =>
                  room &&
                  socket?.emit(
                    "belot:next-hand",
                    { roomId: room.id },
                    () => undefined,
                  )
                }
                onRestart={() => {
                  if (room) {
                    socket?.emit(
                      "game:restart",
                      { roomId: room.id },
                      () => undefined,
                    );
                  }
                }}
              />
            </BelotAssetsGate>
          ) : null}
        </div>

        {activeBelotGame ? null : (
          <aside className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">{messages.matchHistory}</h2>
            <p className="mt-2 text-sm text-slate-600">
              {messages.completedMatches(matchCount)}
            </p>
          </aside>
        )}
      </div>
    </main>
  );
}
