import type { Card } from "@card-games/shared";

import { useI18n } from "../i18n";
import { cardBackImagePath, cardImagePath } from "./card-assets";

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
  alt,
}: {
  compact?: boolean;
  native?: boolean;
  alt?: string;
}) {
  const { messages } = useI18n();

  return (
    <img
      src={cardBackImagePath}
      alt={alt ?? messages.cardBack}
      className={`card-face ${cardSizeClass({
        compact,
        native,
      })} rounded-md bg-white object-contain`}
      loading="eager"
      decoding="async"
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
  const { messages } = useI18n();
  const sizeClass = cardSizeClass({ compact, native });

  if (hidden || !card) {
    return (
      <div
        className={`card-face grid ${sizeClass} place-items-center rounded-md border border-ink/10 bg-ink text-sm font-semibold text-white`}
      >
        {messages.drawn}
      </div>
    );
  }

  const imageUrl = cardImagePath(card);
  const label = messages.cardLabel(card.rank, card.suit);

  return (
    <img
      src={imageUrl}
      alt={label}
      className={`card-face ${sizeClass} rounded-md border border-ink/10 bg-white object-contain`}
      loading="eager"
      decoding="async"
    />
  );
}
