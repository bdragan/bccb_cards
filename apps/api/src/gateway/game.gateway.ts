import {
  type Ack,
  belotDeclarePayloadSchema,
  belotPlayCardPayloadSchema,
  belotTrumpDecisionPayloadSchema,
  createRoomPayloadSchema,
  joinRoomPayloadSchema,
  readyPayloadSchema,
  roomIdPayloadSchema,
} from "@card-games/shared";
import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import type { JwtPayload, RequestUser } from "../auth/auth.types";
import { RoomsService } from "../rooms/rooms.service";

type AuthenticatedSocket = Socket & { user?: RequestUser };

@WebSocketGateway({
  namespace: "/game",
  cors: {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly roomsService: RoomsService,
  ) {}

  handleConnection(client: AuthenticatedSocket) {
    const token = this.extractToken(client);

    if (!token) {
      client.emit("room:error", { message: "Authentication required" });
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      client.user = {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName,
      };
    } catch {
      client.emit("room:error", { message: "Authentication required" });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.roomsService.disconnectSocket(client.id);
  }

  @SubscribeMessage("room:create")
  handleCreate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ roomId: string; roomCode: string }>> {
    return this.safe(client, async () => {
      const body = createRoomPayloadSchema.parse(payload);
      const user = this.requireUser(client);
      const room = this.roomsService.createRoom({
        gameId: body.gameId,
        playerId: user.id,
        displayName: user.displayName,
        socketId: client.id,
      });

      await client.join(room.id);
      this.emitRoom(room.id);

      return { roomId: room.id, roomCode: room.code };
    });
  }

  @SubscribeMessage("room:join")
  handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ roomId: string }>> {
    return this.safe(client, async () => {
      const body = joinRoomPayloadSchema.parse(payload);
      const user = this.requireUser(client);
      const room = this.roomsService.joinRoom({
        roomCode: body.roomCode,
        playerId: user.id,
        displayName: user.displayName,
        socketId: client.id,
      });

      await client.join(room.id);
      this.emitRoom(room.id);

      return { roomId: room.id };
    });
  }

  @SubscribeMessage("room:leave")
  handleLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ ok: true }>> {
    return this.safe(client, () => {
      const body = roomIdPayloadSchema.parse(payload);
      const user = this.requireUser(client);
      this.roomsService.leaveRoom(body.roomId, user.id, client.id);
      void client.leave(body.roomId);
      this.emitRoom(body.roomId);
      return { ok: true };
    });
  }

  @SubscribeMessage("player:ready")
  handleReady(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ ok: true }>> {
    return this.safe(client, () => {
      const body = readyPayloadSchema.parse(payload);
      const user = this.requireUser(client);
      this.roomsService.setReady(body.roomId, user.id, body.ready);
      this.emitRoom(body.roomId);
      return { ok: true };
    });
  }

  @SubscribeMessage("game:draw-card")
  async handleDraw(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ ok: true }>> {
    return this.safe(client, async () => {
      const body = roomIdPayloadSchema.parse(payload);
      const user = this.requireUser(client);
      await this.roomsService.drawCard(body.roomId, user.id);
      this.emitRoom(body.roomId);
      return { ok: true };
    });
  }

  @SubscribeMessage("belot:trump-decision")
  async handleBelotTrumpDecision(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ ok: true }>> {
    return this.safe(client, async () => {
      const body = belotTrumpDecisionPayloadSchema.parse(payload);
      const user = this.requireUser(client);
      await this.roomsService.belotTrumpDecision(
        body.roomId,
        user.id,
        body.kind === "choose-suit"
          ? { kind: body.kind, suit: body.suit }
          : { kind: body.kind },
      );
      this.emitRoom(body.roomId);
      return { ok: true };
    });
  }

  @SubscribeMessage("belot:declare")
  async handleBelotDeclare(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ ok: true }>> {
    return this.safe(client, async () => {
      const body = belotDeclarePayloadSchema.parse(payload);
      const user = this.requireUser(client);
      await this.roomsService.belotDeclare(
        body.roomId,
        user.id,
        body.declarations,
      );
      this.emitRoom(body.roomId);
      return { ok: true };
    });
  }

  @SubscribeMessage("belot:play-card")
  async handleBelotPlayCard(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ ok: true }>> {
    return this.safe(client, async () => {
      const body = belotPlayCardPayloadSchema.parse(payload);
      const user = this.requireUser(client);
      await this.roomsService.belotPlayCard(body.roomId, user.id, body.cardId);
      this.emitRoom(body.roomId);
      return { ok: true };
    });
  }

  @SubscribeMessage("belot:next-hand")
  async handleBelotNextHand(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ ok: true }>> {
    return this.safe(client, async () => {
      const body = roomIdPayloadSchema.parse(payload);
      this.requireUser(client);
      await this.roomsService.belotNextHand(body.roomId);
      this.emitRoom(body.roomId);
      return { ok: true };
    });
  }

  @SubscribeMessage("game:restart")
  handleRestart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack<{ ok: true }>> {
    return this.safe(client, () => {
      const body = roomIdPayloadSchema.parse(payload);
      this.requireUser(client);
      this.roomsService.restart(body.roomId);
      this.emitRoom(body.roomId);
      return { ok: true };
    });
  }

  emitRoom(roomId: string) {
    const room = this.roomsService.getRoom(roomId);
    const roomState = this.roomsService.publicRoomState(room);

    this.server.to(roomId).emit("room:state", roomState);

    for (const player of room.players) {
      for (const socketId of player.socketIds) {
        this.server
          .to(socketId)
          .emit(
            "game:state",
            this.roomsService.publicGameState(room, player.playerId),
          );
      }
    }

    if (room.state.phase === "revealed" || room.state.phase === "finished") {
      this.server
        .to(roomId)
        .emit("game:result", this.roomsService.result(room));
    }
  }

  private extractToken(client: Socket) {
    const authToken = client.handshake.auth?.token;
    const header = client.handshake.headers.authorization;

    if (typeof authToken === "string") {
      return authToken;
    }

    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length);
    }

    return undefined;
  }

  private requireUser(client: AuthenticatedSocket) {
    if (!client.user) {
      throw new Error("Authentication required");
    }

    return client.user;
  }

  private async safe<T>(
    client: AuthenticatedSocket,
    callback: () => T | Promise<T>,
  ): Promise<Ack<T>> {
    try {
      return { ok: true, data: await callback() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed";
      this.logger.warn(message);
      client.emit("room:error", { message });
      return { ok: false, error: message };
    }
  }
}
