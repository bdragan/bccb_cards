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
  compact = false,
}: {
  card?: Card;
  hidden?: boolean;
  compact?: boolean;
}) {
  const sizeClass = compact ? "h-24 w-16" : "h-36 w-24";

  if (hidden || !card) {
    return (
      <div
        className={`card-face grid ${sizeClass} place-items-center rounded-md border border-ink/10 bg-ink text-sm font-semibold text-white`}
      >
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
      className={`card-face ${sizeClass} rounded-md border border-ink/10 bg-white object-contain`}
      loading="lazy"
    />
  );
}
