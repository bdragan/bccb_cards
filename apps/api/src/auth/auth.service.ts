import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcrypt";
import { type AuthResponse, type LoginDto, type RegisterDto } from "@card-games/shared";
import { UsersService } from "../users/users.service";
import type { JwtPayload, RequestUser } from "./auth.types";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const passwordHash = await hash(dto.password, 12);
    const user = await this.usersService.createUser({
      email: dto.email,
      displayName: dto.displayName,
      passwordHash
    });

    return this.issueToken({ id: user.id, email: user.email, displayName: user.displayName });
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.issueToken({ id: user.id, email: user.email, displayName: user.displayName });
  }

  issueToken(user: RequestUser): AuthResponse {
    const payload: JwtPayload = { sub: user.id, email: user.email, displayName: user.displayName };

    return {
      accessToken: this.jwtService.sign(payload),
      user
    };
  }
}
