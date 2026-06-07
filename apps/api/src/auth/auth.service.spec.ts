import { ConflictException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const usersService = {
    createUser: jest.fn(),
    findByEmail: jest.fn(),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      usersService as never,
      new JwtService({ secret: "test" }),
    );
  });

  it("registers a user", async () => {
    usersService.createUser.mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      displayName: "Alice",
      passwordHash: "hash",
    });

    const result = await service.register({
      email: "a@example.com",
      displayName: "Alice",
      password: "password123",
    });

    expect(result.user.id).toBe("u1");
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it("rejects duplicate email", async () => {
    usersService.createUser.mockRejectedValue(
      new ConflictException("Email is already registered"),
    );

    await expect(
      service.register({
        email: "a@example.com",
        displayName: "Alice",
        password: "password123",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
