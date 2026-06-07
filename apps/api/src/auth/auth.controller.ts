import {
  type LoginDto,
  loginSchema,
  type RegisterDto,
  registerSchema,
} from "@card-games/shared";
import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";

import { AuthService } from "./auth.service";
import type { RequestUser } from "./auth.types";
import { JwtAuthGuard } from "./jwt-auth.guard";

type AuthenticatedRequest = { user: RequestUser };

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  register(@Body() body: RegisterDto) {
    return this.authService.register(registerSchema.parse(body));
  }

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.authService.login(loginSchema.parse(body));
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }
}
