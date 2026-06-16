import { belotDefinition } from "./games/belot";

export const gameRegistry = {
  belot: belotDefinition,
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
