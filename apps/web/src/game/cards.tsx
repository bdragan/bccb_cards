import type { Card } from "@card-games/shared";

const suitLabels = {
  acorns: "Acorns",
  bells: "Bells",
  hearts: "Hearts",
  leaves: "Leaves",
} as const;

function cardSizeClass({
  compact = false,
  native = false,
}: {
  compact?: boolean;
  native?: boolean;
}) {
  return native ? "h-[114px] w-[71px]" : compact ? "h-24 w-16" : "h-36 w-24";
}

export function PlayingCardBack({
  compact = false,
  native = false,
  alt = "Card back",
}: {
  compact?: boolean;
  native?: boolean;
  alt?: string;
}) {
  return (
    <img
      src="/cards/card-back.svg"
      alt={alt}
      className={`card-face ${cardSizeClass({
        compact,
        native,
      })} rounded-md bg-white object-contain`}
      loading="lazy"
    />
  );
}

export function PlayingCard({
  card,
  hidden = false,
  compact = false,
  native = false,
}: {
  card?: Card;
  hidden?: boolean;
  compact?: boolean;
  native?: boolean;
}) {
  const sizeClass = cardSizeClass({ compact, native });

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
