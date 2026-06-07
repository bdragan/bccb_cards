import type { Card } from "@card-games/shared";

const suitSymbols = {
  clubs: "C",
  diamonds: "D",
  hearts: "H",
  spades: "S"
} as const;

export function PlayingCard({ card, hidden = false }: { card?: Card; hidden?: boolean }) {
  if (hidden || !card) {
    return (
      <div className="card-face grid h-36 w-24 place-items-center rounded-md border border-ink/10 bg-ink text-sm font-semibold text-white">
        Drawn
      </div>
    );
  }

  const red = card.suit === "diamonds" || card.suit === "hearts";

  return (
    <div className="card-face flex h-36 w-24 flex-col justify-between rounded-md border border-ink/10 bg-white p-3">
      <div className={`text-xl font-bold ${red ? "text-red-600" : "text-ink"}`}>{card.rank}</div>
      <div className={`text-center text-3xl font-bold ${red ? "text-red-600" : "text-ink"}`}>
        {suitSymbols[card.suit]}
      </div>
      <div className={`self-end text-xl font-bold ${red ? "text-red-600" : "text-ink"}`}>{card.rank}</div>
    </div>
  );
}
