import { describe, expect, it } from "vitest";

import {
  createRoomPayloadSchema,
  gameIds,
  joinRoomPayloadSchema,
  readyPayloadSchema,
} from "../src";

describe("shared schemas", () => {
  it("accept valid socket payloads", () => {
    expect(
      createRoomPayloadSchema.safeParse({ gameId: "bellot" }).success,
    ).toBe(true);
    expect(
      joinRoomPayloadSchema.safeParse({ roomCode: "ABCD12" }).success,
    ).toBe(true);
    expect(
      readyPayloadSchema.safeParse({ roomId: "room-1", ready: true }).success,
    ).toBe(true);
  });

  it("reject invalid socket payloads", () => {
    expect(
      createRoomPayloadSchema.safeParse({ gameId: "greater-card" }).success,
    ).toBe(false);
    expect(createRoomPayloadSchema.safeParse({ gameId: "poker" }).success).toBe(
      false,
    );
    expect(joinRoomPayloadSchema.safeParse({ roomCode: "" }).success).toBe(
      false,
    );
    expect(
      readyPayloadSchema.safeParse({ roomId: "room-1", ready: "yes" }).success,
    ).toBe(false);
  });

  it("registers Bellot as the only game id", () => {
    expect(gameIds).toEqual(["bellot"]);
  });
});
