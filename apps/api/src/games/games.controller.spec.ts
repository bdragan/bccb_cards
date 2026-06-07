import { GamesController } from "./games.controller";

describe("GamesController", () => {
  it("returns GreaterCard", () => {
    expect(new GamesController().list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "greater-card",
          displayName: "GreaterCard"
        })
      ])
    );
  });
});
