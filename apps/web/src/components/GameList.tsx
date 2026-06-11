import type { GameId, GameMetadata } from "@card-games/shared";

import { Button } from "./Button";

export function GameList({
  games,
  selectedGameId,
  onSelect,
}: {
  games: GameMetadata[];
  selectedGameId?: string;
  onSelect: (gameId: GameId) => void;
}) {
  return (
    <section aria-label="Available games">
      <h2 className="text-lg font-bold">Games</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {games.map((game) => (
          <article
            key={game.id}
            className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold">{game.displayName}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {game.description}
                </p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {game.minPlayers}-{game.maxPlayers} players
                </p>
              </div>
              <Button
                aria-pressed={selectedGameId === game.id}
                onClick={() => onSelect(game.id)}
                type="button"
                variant={selectedGameId === game.id ? "selected" : "primary"}
              >
                {selectedGameId === game.id ? "Selected" : "Select"}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
