import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  createCompletedMatch(input: {
    gameId: string;
    roomCode?: string;
    startedAt: Date;
    finishedAt: Date;
    result: {
      winnerPlayerIds: string[];
      tied: boolean;
      players: Array<{
        playerId: string;
        card?: Prisma.InputJsonValue;
        outcome: "win" | "loss" | "tie";
        score?: number;
      }>;
    };
  }) {
    return this.prisma.match.create({
      data: {
        gameId: input.gameId,
        roomCode: input.roomCode,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        resultJson: input.result,
        players: {
          create: input.result.players.map((player) => ({
            userId: player.playerId,
            outcome: player.outcome,
            cardJson: player.card,
            score: player.score,
          })),
        },
      },
      include: { players: true },
    });
  }

  findForUser(userId: string) {
    return this.prisma.match.findMany({
      where: { players: { some: { userId } } },
      include: { players: true },
      orderBy: { finishedAt: "desc" },
    });
  }

  async findById(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: { players: true },
    });

    if (!match) {
      throw new NotFoundException("Match not found");
    }

    return match;
  }
}
