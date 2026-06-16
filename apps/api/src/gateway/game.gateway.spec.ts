import { JwtService } from "@nestjs/jwt";

import { GameGateway } from "./game.gateway";

describe("GameGateway", () => {
  const jwtService = new JwtService({ secret: "test" });

  it("rejects unauthenticated sockets", () => {
    const gateway = new GameGateway(
      jwtService,
      {} as never,
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

  it("rejects sockets for tokens whose user no longer exists", async () => {
    const gateway = new GameGateway(
      jwtService,
      {} as never,
      { findById: jest.fn().mockResolvedValue(null) } as never,
    );
    const client = {
      handshake: {
        auth: {
          token: jwtService.sign({
            sub: "missing-user",
            email: "old@example.test",
            displayName: "Old User",
          }),
        },
        headers: {},
      },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(client as never);

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
      jwtService,
      roomsService as never,
      {} as never,
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
