import { GamesController } from "./games.controller";

describe("GamesController", () => {
  it("returns Belot as the only listed game", () => {
    expect(new GamesController().list()).toEqual([
      expect.objectContaining({
        id: "belot",
        displayName: "Belot",
      }),
    ]);
  });
});
