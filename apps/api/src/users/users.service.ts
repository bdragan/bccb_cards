import { ConflictException, Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async createUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<User> {
    const email = input.email.toLowerCase();
    const existing = await this.findByEmail(email);

    if (existing) {
      throw new ConflictException("Email is already registered");
    }

    return this.prisma.user.create({
      data: {
        email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
      },
    });
  }
}
