import { JwtService } from "@nestjs/jwt";

import { GameGateway } from "./game.gateway";

describe("GameGateway", () => {
  it("rejects unauthenticated sockets", () => {
    const gateway = new GameGateway(
      new JwtService({ secret: "test" }),
      {} as never,
    );
    const client = {
      handshake: { auth: {}, headers: {} },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    gateway.handleConnection(client as never);

    expect(client.emit).toHaveBeenCalledWith("room:error", {
      message: "Authentication required",
    });
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("emits viewer-specific game state to each player socket", () => {
    const emitted = new Map<string, jest.Mock>();
    const room = {
      id: "room1",
      players: [
        { playerId: "p1", socketIds: new Set(["s1"]) },
        { playerId: "p2", socketIds: new Set(["s2"]) },
      ],
      state: { phase: "trick-play" },
    };
    const roomsService = {
      getRoom: jest.fn().mockReturnValue(room),
      publicRoomState: jest.fn().mockReturnValue({ id: "room1" }),
      publicGameState: jest.fn((_room, viewerPlayerId: string) => ({
        viewerPlayerId,
      })),
      result: jest.fn(),
    };
    const gateway = new GameGateway(
      new JwtService({ secret: "test" }),
      roomsService as never,
    );
    gateway.server = {
      to: jest.fn((target: string) => {
        const emit = jest.fn();
        emitted.set(target, emit);
        return { emit };
      }),
    } as never;

    gateway.emitRoom("room1");

    expect(emitted.get("room1")).toHaveBeenCalledWith("room:state", {
      id: "room1",
    });
    expect(emitted.get("s1")).toHaveBeenCalledWith("game:state", {
      viewerPlayerId: "p1",
    });
    expect(emitted.get("s2")).toHaveBeenCalledWith("game:state", {
      viewerPlayerId: "p2",
    });
    expect(roomsService.publicGameState).toHaveBeenCalledWith(room, "p1");
    expect(roomsService.publicGameState).toHaveBeenCalledWith(room, "p2");
  });
});
