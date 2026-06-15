import { GamesController } from "./games.controller";

describe("GamesController", () => {
  it("returns Bellot as the only listed game", () => {
    expect(new GamesController().list()).toEqual([
      expect.objectContaining({
        id: "bellot",
        displayName: "Bellot",
      }),
    ]);
  });
});
