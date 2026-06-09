import {
  type Card,
  type Rank,
  ranks,
  type Suit,
  suits,
} from "@card-games/shared";

export function rankValue(rank: Rank): number {
  return ranks.indexOf(rank) + 7;
}

export function compareRanks(left: Rank, right: Rank): number {
  return rankValue(left) - rankValue(right);
}

export function suitValue(suit: Suit): number {
  return suits.indexOf(suit) + 1;
}

export function compareSuits(left: Suit, right: Suit): number {
  return suitValue(left) - suitValue(right);
}

export function cardValue(card: Card): number {
  return rankValue(card.rank) * 10 + suitValue(card.suit);
}

export function compareCards(left: Card, right: Card): number {
  const rankComparison = compareRanks(left.rank, right.rank);

  return rankComparison === 0
    ? compareSuits(left.suit, right.suit)
    : rankComparison;
}
