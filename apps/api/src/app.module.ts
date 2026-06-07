import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { JwtStrategy } from "./auth/jwt.strategy";
import { GameGateway } from "./gateway/game.gateway";
import { GamesController } from "./games/games.controller";
import { HealthController } from "./health.controller";
import { MatchesController } from "./matches/matches.controller";
import { MatchesService } from "./matches/matches.service";
import { PrismaService } from "./prisma/prisma.service";
import { RoomsService } from "./rooms/rooms.service";
import { UsersService } from "./users/users.service";

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? "change-me-in-dev",
      signOptions: { expiresIn: "7d" }
    })
  ],
  controllers: [AuthController, GamesController, HealthController, MatchesController],
  providers: [AuthService, JwtStrategy, PrismaService, UsersService, RoomsService, MatchesService, GameGateway]
})
export class AppModule {}
