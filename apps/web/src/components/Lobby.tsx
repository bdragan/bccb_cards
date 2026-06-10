import type { RoomPublicState } from "@card-games/shared";

import { Button } from "./Button";

const gameNames: Record<RoomPublicState["gameId"], string> = {
  "greater-card": "GreaterCard",
  bellot: "Bellot",
};

export function Lobby({
  room,
  currentPlayerId,
  onReady,
}: {
  room: RoomPublicState;
  currentPlayerId?: string;
  onReady: (ready: boolean) => void;
}) {
  const currentPlayer = room.players.find(
    (player) => player.playerId === currentPlayerId,
  );

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Lobby</h2>
          <p className="text-sm text-slate-600">
            Room code{" "}
            <span className="font-mono font-bold text-ink">{room.code}</span>
          </p>
          <p className="text-sm text-slate-600">
            Game{" "}
            <span className="font-semibold text-ink">
              {gameNames[room.gameId]}
            </span>
          </p>
        </div>
        <Button
          onClick={() => onReady(!currentPlayer?.ready)}
          disabled={!currentPlayer}
        >
          {currentPlayer?.ready ? "Unready" : "Ready"}
        </Button>
      </div>

      <ul className="mt-4 divide-y divide-slate-100">
        {room.players.map((player) => (
          <li
            key={player.playerId}
            className="flex items-center justify-between py-3"
          >
            <span className="font-medium">{player.displayName}</span>
            <span
              className={`text-sm font-semibold ${player.ready ? "text-felt" : "text-slate-500"}`}
            >
              {player.ready ? "Ready" : "Waiting"}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm text-slate-600">
        The server starts {gameNames[room.gameId]} automatically when at least
        two players have joined and everyone is ready.
      </p>
    </section>
  );
}
