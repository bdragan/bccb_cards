import {
  applyBellotAction,
  type BellotAction,
  type BellotCpuOptions,
  type BellotState,
  createBellotInitialState,
  defaultBellotCpuMaxSearchPlies,
  getBellotPublicState,
} from "@card-games/game-core";
import type {
  BellotDeclaration,
  BellotPublicState,
  GamePublicState,
  RoomPublicState,
  Suit,
} from "@card-games/shared";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import { BellotTable } from "../components/BellotTable";
import { Button } from "../components/Button";
import { Lobby } from "../components/Lobby";
import { createGameSocket, type GameSocket } from "../socket/game-socket";
import { useAuthStore } from "../stores/auth-store";
import type {
  BellotCpuWorkerRequest,
  BellotCpuWorkerResponse,
} from "../workers/bellot-cpu.worker";

const offlineCpuPlayerId = "offline-cpu";
const offlineCpuDecisionDelayMs = 250;
const offlineCpuPlayDelayMs = 450;
const offlineCpuCompletedTrickLeadDelayMs = 2_000;

function offlineCpuActionDelay(state: BellotState) {
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

function isOfflineCpuTurn(state: BellotState) {
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

export function Dashboard() {
  const { token, user, logout } = useAuthStore();
  const [matches, setMatches] = useState<unknown[]>([]);
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<RoomPublicState>();
  const [gameState, setGameState] = useState<GamePublicState>();
  const [offlineBellotState, setOfflineBellotState] = useState<BellotState>();
  const [error, setError] = useState<string>();
  const [socket, setSocket] = useState<GameSocket>();
  const offlineCpuWorkerRef = useRef<Worker | null>(null);
  const offlineCpuRequestIdRef = useRef(0);
  const offlineCpuPendingStateRef = useRef<BellotState | null>(null);

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
      new URL("../workers/bellot-cpu.worker.ts", import.meta.url),
      { type: "module" },
    );

    offlineCpuWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<BellotCpuWorkerResponse>) => {
      const { requestId, action, error: workerError } = event.data;

      if (requestId !== offlineCpuRequestIdRef.current) {
        return;
      }

      const requestedState = offlineCpuPendingStateRef.current;
      offlineCpuPendingStateRef.current = null;

      if (!requestedState) {
        return;
      }

      setOfflineBellotState((current) => {
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

        return action ? applyBellotAction(current, action) : current;
      });
    };

    worker.onerror = (event) => {
      const requestedState = offlineCpuPendingStateRef.current;
      offlineCpuPendingStateRef.current = null;

      if (!requestedState) {
        return;
      }

      setOfflineBellotState((current) =>
        current === requestedState
          ? {
              ...current,
              phase: "error",
              error: event.message || "CPU action failed",
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
  }, []);

  const inLobby =
    room &&
    (room.phase === "waiting-for-players" || room.phase === "ready-check");
  const matchCount = useMemo(() => matches.length, [matches]);
  const activeBellotGame =
    Boolean(offlineBellotState) || (gameState?.gameId === "bellot" && !inLobby);
  const offlineHumanPlayerId =
    offlineBellotState?.players.find(
      (player) => player.playerId !== offlineCpuPlayerId,
    )?.playerId ?? user?.id;
  const offlineBellotPublicState = useMemo<BellotPublicState | undefined>(
    () =>
      offlineBellotState && offlineHumanPlayerId
        ? getBellotPublicState(offlineBellotState, offlineHumanPlayerId)
        : undefined,
    [offlineBellotState, offlineHumanPlayerId],
  );

  useEffect(() => {
    if (!offlineBellotState) {
      return;
    }

    const cpuOptions: BellotCpuOptions = {
      maxSearchPlies: defaultBellotCpuMaxSearchPlies,
      monteCarloSamples: 64,
    };

    if (!isOfflineCpuTurn(offlineBellotState)) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const worker = offlineCpuWorkerRef.current;

      if (!worker) {
        setOfflineBellotState((current) =>
          current === offlineBellotState
            ? {
                ...current,
                phase: "error",
                error: "CPU worker is not available",
              }
            : current,
        );
        return;
      }

      const requestId = offlineCpuRequestIdRef.current + 1;
      offlineCpuRequestIdRef.current = requestId;
      offlineCpuPendingStateRef.current = offlineBellotState;
      worker.postMessage({
        requestId,
        state: offlineBellotState,
        cpuPlayerId: offlineCpuPlayerId,
        options: cpuOptions,
      } satisfies BellotCpuWorkerRequest);
    }, offlineCpuActionDelay(offlineBellotState));

    return () => window.clearTimeout(timeout);
  }, [offlineBellotState]);

  function createRoom() {
    setOfflineBellotState(undefined);
    socket?.emit("room:create", { gameId: "bellot" }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
      }
    });
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    setOfflineBellotState(undefined);
    socket?.emit("room:join", { roomCode }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
      }
    });
  }

  function createOfflineBellotState() {
    const humanPlayerId = user?.id ?? "offline-human";
    let nextState = createBellotInitialState([
      {
        playerId: humanPlayerId,
        displayName: user?.displayName ?? "You",
      },
      { playerId: offlineCpuPlayerId, displayName: "CPU" },
    ]);

    nextState = applyBellotAction(nextState, {
      type: "set-ready",
      playerId: humanPlayerId,
      ready: true,
    });
    nextState = applyBellotAction(nextState, {
      type: "set-ready",
      playerId: offlineCpuPlayerId,
      ready: true,
    });

    return nextState;
  }

  function startOfflineBellot() {
    setRoom(undefined);
    setGameState(undefined);
    setError(undefined);
    setOfflineBellotState(createOfflineBellotState());
  }

  function applyOfflineBellotAction(action: BellotAction) {
    setOfflineBellotState((current) =>
      current ? applyBellotAction(current, action) : current,
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
      applyOfflineBellotAction({
        type: "trump-pass",
        playerId: offlineHumanPlayerId,
      });
    } else if (decision.kind === "accept-upcard") {
      applyOfflineBellotAction({
        type: "trump-accept-upcard",
        playerId: offlineHumanPlayerId,
      });
    } else {
      applyOfflineBellotAction({
        type: "trump-choose-suit",
        playerId: offlineHumanPlayerId,
        suit: decision.suit,
      });
    }
  }

  function submitOfflineDeclarations(declarations: BellotDeclaration[]) {
    if (!offlineHumanPlayerId) {
      return;
    }

    applyOfflineBellotAction({
      type: "declare",
      playerId: offlineHumanPlayerId,
      declarations,
    });
  }

  return (
    <main className="app-background min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">Card Games Platform</h1>
            <p className="text-sm text-slate-600">
              {user?.displayName ?? "Signed in"}
            </p>
          </div>
          <Button type="button" onClick={logout}>
            Logout
          </Button>
        </div>
      </header>

      <div
        className={`mx-auto grid max-w-6xl gap-5 px-4 py-6 ${
          activeBellotGame ? "" : "lg:grid-cols-[1fr_340px]"
        }`}
      >
        <div className="space-y-5">
          {activeBellotGame ? null : (
            <>
              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold">Room</h2>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button type="button" onClick={createRoom} disabled={!socket}>
                    Create room
                  </Button>
                  <Button type="button" onClick={startOfflineBellot}>
                    Play Bellot vs CPU
                  </Button>
                  <form
                    onSubmit={joinRoom}
                    className="flex min-w-0 flex-1 gap-2"
                  >
                    <input
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 uppercase"
                      placeholder="Room code"
                      value={roomCode}
                      onChange={(event) => setRoomCode(event.target.value)}
                    />
                    <Button
                      type="submit"
                      disabled={!socket || roomCode.length < 4}
                    >
                      Join
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

          {offlineBellotPublicState ? (
            <>
              <section className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold">Offline match</h2>
                    <p className="text-sm text-slate-600">
                      Bellot vs CPU runs entirely in this browser.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setOfflineBellotState(undefined)}
                  >
                    Leave match
                  </Button>
                </div>
              </section>
              <BellotTable
                state={offlineBellotPublicState}
                currentPlayerId={offlineHumanPlayerId}
                onTrumpDecision={applyOfflineTrumpDecision}
                onDeclare={submitOfflineDeclarations}
                onPlayCard={(cardId) =>
                  offlineHumanPlayerId &&
                  applyOfflineBellotAction({
                    type: "play-card",
                    playerId: offlineHumanPlayerId,
                    cardId,
                  })
                }
                onNextHand={() =>
                  applyOfflineBellotAction({ type: "next-hand" })
                }
                onRestart={() =>
                  setOfflineBellotState(createOfflineBellotState())
                }
              />
            </>
          ) : gameState && !inLobby && gameState.gameId === "bellot" ? (
            <BellotTable
              state={gameState}
              currentPlayerId={user?.id}
              onTrumpDecision={(decision) =>
                room &&
                socket?.emit(
                  "bellot:trump-decision",
                  { roomId: room.id, ...decision },
                  () => undefined,
                )
              }
              onDeclare={(declarations) =>
                room &&
                socket?.emit(
                  "bellot:declare",
                  { roomId: room.id, declarations },
                  () => undefined,
                )
              }
              onPlayCard={(cardId) =>
                room &&
                socket?.emit(
                  "bellot:play-card",
                  { roomId: room.id, cardId },
                  () => undefined,
                )
              }
              onNextHand={() =>
                room &&
                socket?.emit(
                  "bellot:next-hand",
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
          ) : null}
        </div>

        {activeBellotGame ? null : (
          <aside className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Match history</h2>
            <p className="mt-2 text-sm text-slate-600">
              {matchCount} completed matches
            </p>
          </aside>
        )}
      </div>
    </main>
  );
}
