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

  it("handles draw-card event", async () => {
    const roomsService = {
      drawCard: jest.fn().mockResolvedValue({ id: "room1" }),
      getRoom: jest.fn().mockReturnValue({
        id: "room1",
        players: [],
        state: { phase: "drawing" },
      }),
      publicRoomState: jest.fn().mockReturnValue({ id: "room1" }),
      result: jest.fn(),
      publicGameState: jest.fn(),
    };
    const gateway = new GameGateway(
      new JwtService({ secret: "test" }),
      roomsService as never,
    );
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    } as never;

    const response = await gateway.handleDraw(
      { id: "s1", user: { id: "p1" }, emit: jest.fn() } as never,
      {
        roomId: "room1",
      },
    );

    expect(response.ok).toBe(true);
    expect(roomsService.drawCard).toHaveBeenCalledWith("room1", "p1");
  });
});
