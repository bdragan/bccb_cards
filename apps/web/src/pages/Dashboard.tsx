import {
  applyBellotAction,
  type BellotAction,
  type BellotState,
  chooseBellotCpuAction,
  createBellotInitialState,
  getBellotPublicState,
} from "@card-games/game-core";
import type {
  BellotDeclaration,
  BellotPublicState,
  GameId,
  GameMetadata,
  GamePublicState,
  GameResult,
  RoomPublicState,
  Suit,
} from "@card-games/shared";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { BellotTable } from "../components/BellotTable";
import { Button } from "../components/Button";
import { GameList } from "../components/GameList";
import { GreaterCardTable } from "../components/GreaterCardTable";
import { Lobby } from "../components/Lobby";
import { createGameSocket, type GameSocket } from "../socket/game-socket";
import { useAuthStore } from "../stores/auth-store";

const offlineCpuPlayerId = "offline-cpu";
const offlineCpuDecisionDelayMs = 250;
const offlineCpuPlayDelayMs = 450;
const offlineCpuCompletedTrickLeadDelayMs = 2_000;

function offlineCpuActionDelay(state: BellotState, action: BellotAction) {
  if (action.type !== "play-card") {
    return offlineCpuDecisionDelayMs;
  }

  const isLeadingAfterCompletedTrick =
    state.currentTrick.length === 0 && state.completedTricks.length > 0;

  return isLeadingAfterCompletedTrick
    ? offlineCpuCompletedTrickLeadDelayMs
    : offlineCpuPlayDelayMs;
}

export function Dashboard() {
  const { token, user, logout } = useAuthStore();
  const [games, setGames] = useState<GameMetadata[]>([]);
  const [matches, setMatches] = useState<unknown[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<GameId>("greater-card");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<RoomPublicState>();
  const [gameState, setGameState] = useState<GamePublicState>();
  const [offlineBellotState, setOfflineBellotState] = useState<BellotState>();
  const [result, setResult] = useState<GameResult>();
  const [error, setError] = useState<string>();
  const [socket, setSocket] = useState<GameSocket>();

  useEffect(() => {
    if (!token) {
      return;
    }

    void api
      .games(token)
      .then(setGames)
      .catch((err: Error) => setError(err.message));
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
    nextSocket.on("game:result", (payload) => {
      setResult(payload);
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

    const cpuOptions = {
      maxSearchPlies: 10,
      monteCarloSamples: 32,
    };
    let action: BellotAction | undefined;

    try {
      action = chooseBellotCpuAction(
        offlineBellotState,
        offlineCpuPlayerId,
        cpuOptions,
      );
    } catch (err) {
      setOfflineBellotState({
        ...offlineBellotState,
        phase: "error",
        error: err instanceof Error ? err.message : "CPU action failed",
      });

      return;
    }

    if (!action) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setOfflineBellotState((current) => {
        if (!current) {
          return current;
        }

        try {
          const nextAction = chooseBellotCpuAction(
            current,
            offlineCpuPlayerId,
            cpuOptions,
          );

          return nextAction ? applyBellotAction(current, nextAction) : current;
        } catch (err) {
          return {
            ...current,
            phase: "error",
            error: err instanceof Error ? err.message : "CPU action failed",
          };
        }
      });
    }, offlineCpuActionDelay(offlineBellotState, action));

    return () => window.clearTimeout(timeout);
  }, [offlineBellotState]);

  function createRoom() {
    setOfflineBellotState(undefined);
    setResult(undefined);
    socket?.emit("room:create", { gameId: selectedGameId }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
      }
    });
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    setOfflineBellotState(undefined);
    setResult(undefined);
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
    setResult(undefined);
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
    <main className="min-h-screen bg-[#f6f3ed]">
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
              <GameList
                games={games}
                selectedGameId={selectedGameId}
                onSelect={setSelectedGameId}
              />

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
          ) : gameState && !inLobby ? (
            gameState.gameId === "greater-card" ? (
              <GreaterCardTable
                state={gameState}
                result={result?.gameId === "greater-card" ? result : undefined}
                currentPlayerId={user?.id}
                onDraw={() =>
                  room &&
                  socket?.emit(
                    "game:draw-card",
                    { roomId: room.id },
                    () => undefined,
                  )
                }
                onRestart={() => {
                  if (room) {
                    setResult(undefined);
                    socket?.emit(
                      "game:restart",
                      { roomId: room.id },
                      () => undefined,
                    );
                  }
                }}
              />
            ) : (
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
                    setResult(undefined);
                    socket?.emit(
                      "game:restart",
                      { roomId: room.id },
                      () => undefined,
                    );
                  }
                }}
              />
            )
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
