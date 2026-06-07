import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestUser } from "../auth/auth.types";
import { MatchesService } from "./matches.service";

type AuthenticatedRequest = { user: RequestUser };

@UseGuards(JwtAuthGuard)
@Controller("matches")
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    return this.matchesService.findForUser(request.user.id);
  }

  @Get(":id")
  byId(@Param("id") id: string) {
    return this.matchesService.findById(id);
  }
}
