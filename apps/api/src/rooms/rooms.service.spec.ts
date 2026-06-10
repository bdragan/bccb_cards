import { RoomsService } from "./rooms.service";

describe("RoomsService", () => {
  const matchesService = {
    createCompletedMatch: jest.fn().mockResolvedValue({ id: "m1" }),
  };

  it("creates and joins a room", () => {
    const service = new RoomsService(matchesService as never);
    const room = service.createRoom({
      gameId: "greater-card",
      playerId: "p1",
      displayName: "Player One",
      socketId: "s1",
    });

    service.joinRoom({
      roomCode: room.code,
      playerId: "p2",
      displayName: "Player Two",
      socketId: "s2",
    });

    expect(service.getRoom(room.id).players).toHaveLength(2);
  });

  it("saves a match result after the game finishes", async () => {
    const service = new RoomsService(matchesService as never);
    const room = service.createRoom({
      gameId: "greater-card",
      playerId: "p1",
      displayName: "Player One",
      socketId: "s1",
    });
    service.joinRoom({
      roomCode: room.code,
      playerId: "p2",
      displayName: "Player Two",
      socketId: "s2",
    });
    service.setReady(room.id, "p1", true);
    service.setReady(room.id, "p2", true);
    await service.drawCard(room.id, "p1");
    await service.drawCard(room.id, "p2");

    expect(matchesService.createCompletedMatch).toHaveBeenCalled();
  });

  it("ignores stale Bellot declaration submissions", async () => {
    const service = new RoomsService(matchesService as never);
    const room = service.createRoom({
      gameId: "bellot",
      playerId: "p1",
      displayName: "Player One",
      socketId: "s1",
    });
    service.joinRoom({
      roomCode: room.code,
      playerId: "p2",
      displayName: "Player Two",
      socketId: "s2",
    });
    service.setReady(room.id, "p1", true);
    service.setReady(room.id, "p2", true);

    const readyState = service.getRoom(room.id).state;

    if (readyState.gameId !== "bellot") {
      throw new Error("Expected a Bellot room");
    }

    await service.bellotTrumpDecision(room.id, readyState.trumpTurnPlayerId!, {
      kind: "accept-upcard",
    });
    await service.bellotDeclare(room.id, "p1", []);
    await service.bellotDeclare(room.id, "p2", []);
    await service.bellotDeclare(room.id, "p1", []);

    const state = service.getRoom(room.id).state;

    expect(state.gameId).toBe("bellot");
    expect(state.phase).toBe("trick-play");
  });
});
