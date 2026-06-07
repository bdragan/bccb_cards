import type { GreaterCardPublicState, GreaterCardResult } from "@card-games/shared";
import { PlayingCard } from "../game/cards";
import { Button } from "./Button";

export function GreaterCardTable({
  state,
  result,
  currentPlayerId,
  onDraw,
  onRestart
}: {
  state: GreaterCardPublicState;
  result?: GreaterCardResult;
  currentPlayerId?: string;
  onDraw(): void;
  onRestart(): void;
}) {
  const currentPlayer = state.players.find((player) => player.playerId === currentPlayerId);
  const canDraw = state.phase === "drawing" && Boolean(currentPlayer) && !currentPlayer?.hasDrawn;
  const revealed = state.phase === "revealed" || state.phase === "finished";

  return (
    <section className="rounded-md bg-felt p-4 text-white shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">GreaterCard</h2>
          <p className="text-sm text-white/80">Status: {state.phase.replaceAll("-", " ")}</p>
        </div>
        {revealed ? <Button onClick={onRestart}>Play again</Button> : <Button onClick={onDraw} disabled={!canDraw}>Draw card</Button>}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {state.players.map((player) => (
          <article key={player.playerId} className="rounded-md bg-white/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-semibold">{player.displayName}</h3>
              <span className="text-xs font-semibold uppercase text-white/70">
                {player.hasDrawn ? "card drawn" : "waiting"}
              </span>
            </div>
            <PlayingCard card={player.drawnCard} hidden={player.hasDrawn && !player.drawnCard} />
          </article>
        ))}
      </div>

      {result ? (
        <div className="mt-5 rounded-md bg-white p-4 text-ink">
          <h3 className="font-bold">{result.tied ? "Tie game" : "Winner"}</h3>
          <p className="mt-1 text-sm">
            {result.players
              .filter((player) => player.outcome === "win" || player.outcome === "tie")
              .map((player) => player.displayName)
              .join(", ")}
          </p>
        </div>
      ) : currentPlayer?.hasDrawn ? (
        <p className="mt-5 text-sm text-white/80">Waiting for other players to draw.</p>
      ) : null}
    </section>
  );
}
