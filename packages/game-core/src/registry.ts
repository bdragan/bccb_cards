import { greaterCardDefinition } from "./games/greater-card";

export const gameRegistry = {
  "greater-card": greaterCardDefinition,
} as const;

export function listGames() {
  return Object.values(gameRegistry).map(
    ({ id, displayName, description, minPlayers, maxPlayers }) => ({
      id,
      displayName,
      description,
      minPlayers,
      maxPlayers,
    }),
  );
}
