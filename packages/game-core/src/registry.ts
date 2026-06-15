import { bellotDefinition } from "./games/bellot";

export const gameRegistry = {
  bellot: bellotDefinition,
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
