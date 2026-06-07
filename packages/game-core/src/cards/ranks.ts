import { type Rank, ranks } from "@card-games/shared";

export function rankValue(rank: Rank): number {
  return ranks.indexOf(rank) + 2;
}

export function compareRanks(left: Rank, right: Rank): number {
  return rankValue(left) - rankValue(right);
}
