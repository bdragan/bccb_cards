import { createDeck } from "@card-games/game-core";
import type { Card, Suit } from "@card-games/shared";

export const cardBackImagePath = "/cards/card-back.svg";

export const suitImagePaths: Record<Suit, string> = {
  acorns: "/suits/s.png",
  bells: "/suits/d.png",
  hearts: "/suits/h.png",
  leaves: "/suits/c.png",
};

export function cardImagePath(card: Pick<Card, "id">) {
  return `/cards/hungarian/${card.id}.jpg`;
}

export const belotImagePaths = [
  cardBackImagePath,
  ...Object.values(suitImagePaths),
  ...createDeck().map(cardImagePath),
];

let belotImagePreload: Promise<void> | undefined;

export function preloadBelotImages() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  belotImagePreload ??= Promise.all(belotImagePaths.map(preloadImage)).then(
    () => undefined,
  );

  return belotImagePreload;
}

function preloadImage(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();

    image.decoding = "async";
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;

    void image.decode?.().then(resolve, resolve);
  });
}
