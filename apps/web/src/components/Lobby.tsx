import type { RoomPublicState } from "@card-games/shared";

import { useI18n } from "../i18n";
import { Button } from "./Button";

export function Lobby({
  room,
  currentPlayerId,
  onReady,
}: {
  room: RoomPublicState;
  currentPlayerId?: string;
  onReady: (ready: boolean) => void;
}) {
  const { messages } = useI18n();
  const currentPlayer = room.players.find(
    (player) => player.playerId === currentPlayerId,
  );
  const gameName: Record<RoomPublicState["gameId"], string> = {
    belot: messages.belotName,
  };

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{messages.lobby}</h2>
          <p className="text-sm text-slate-600">
            {messages.roomCode}{" "}
            <span
              className="font-mono font-bold text-ink"
              data-testid="room-code"
            >
              {room.code}
            </span>
          </p>
          <p className="text-sm text-slate-600">
            {messages.game}{" "}
            <span className="font-semibold text-ink">
              {gameName[room.gameId]}
            </span>
          </p>
        </div>
        <Button
          onClick={() => onReady(!currentPlayer?.ready)}
          disabled={!currentPlayer}
        >
          {currentPlayer?.ready ? messages.unready : messages.ready}
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
              {player.ready ? messages.ready : messages.waiting}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm text-slate-600">
        {messages.lobbyAutoStart(gameName[room.gameId])}
      </p>
    </section>
  );
}
