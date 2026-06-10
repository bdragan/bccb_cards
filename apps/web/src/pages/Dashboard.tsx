import type {
  GameId,
  GameMetadata,
  GamePublicState,
  GameResult,
  RoomPublicState,
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

export function Dashboard() {
  const { token, user, logout } = useAuthStore();
  const [games, setGames] = useState<GameMetadata[]>([]);
  const [matches, setMatches] = useState<unknown[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<GameId>("greater-card");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<RoomPublicState>();
  const [gameState, setGameState] = useState<GamePublicState>();
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
  const activeBellotGame = gameState?.gameId === "bellot" && !inLobby;

  function createRoom() {
    setResult(undefined);
    socket?.emit("room:create", { gameId: selectedGameId }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
      }
    });
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    setResult(undefined);
    socket?.emit("room:join", { roomCode }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
      }
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

          {gameState && !inLobby ? (
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
