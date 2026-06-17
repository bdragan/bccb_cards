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
let belotImagesLoaded = false;
const decodedBelotImages = new Map<string, HTMLImageElement>();

export function preloadBelotImages() {
  if (isBelotImagePreloadBypassed()) {
    belotImagesLoaded = true;
    return Promise.resolve();
  }

  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  belotImagePreload ??= Promise.all(belotImagePaths.map(preloadImage)).then(
    () => {
      belotImagesLoaded = true;
    },
  );

  return belotImagePreload;
}

export function areBelotImagesLoaded() {
  return isBelotImagePreloadBypassed() || belotImagesLoaded;
}

function isBelotImagePreloadBypassed() {
  return import.meta.env.MODE === "test";
}

function preloadImage(src: string) {
  if (decodedBelotImages.has(src)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const image = new Image();
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      decodedBelotImages.set(src, image);
      resolve();
    };
    const settleLoaded = () => {
      const decode = image.decode?.() ?? Promise.resolve();

      void decode.then(settle, settle);
    };

    image.decoding = "async";
    image.onload = settleLoaded;
    image.onerror = () => resolve();
    image.src = src;

    if (image.complete && image.naturalWidth > 0) {
      settleLoaded();
    }
  });
}
