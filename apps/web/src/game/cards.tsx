import type { Card } from "@card-games/shared";

const suitLabels = {
  acorns: "Acorns",
  bells: "Bells",
  hearts: "Hearts",
  leaves: "Leaves",
} as const;

export function PlayingCard({
  card,
  hidden = false,
}: {
  card?: Card;
  hidden?: boolean;
}) {
  if (hidden || !card) {
    return (
      <div className="card-face grid h-36 w-24 place-items-center rounded-md border border-ink/10 bg-ink text-sm font-semibold text-white">
        Drawn
      </div>
    );
  }

  const imageUrl = `/cards/hungarian/${card.id}.jpg`;
  const label = `${card.rank} of ${suitLabels[card.suit]}`;

  return (
    <img
      src={imageUrl}
      alt={label}
      className="card-face h-36 w-24 rounded-md border border-ink/10 bg-white object-cover"
      loading="lazy"
    />
  );
}
