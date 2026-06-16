import { randomUUID } from "node:crypto";

import {
  applyBelotAction,
  belotDefinition,
  belotResult,
  createBelotInitialState,
  getBelotPublicState,
  listGames,
} from "@card-games/game-core";
import type {
  BelotDeclaration,
  BelotResult,
  GameId,
  GamePublicState,
  GameResult,
  PlayerRef,
  RoomPublicState,
  Suit,
} from "@card-games/shared";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { MatchesService } from "../matches/matches.service";
import type { Room, RoomPlayer } from "./rooms.types";

type RoomGameAction =
  Parameters<typeof applyBelotAction>[1];

function randomId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

@Injectable()
export class RoomsService {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly matchesService: MatchesService) {}

  createRoom(input: {
    gameId: GameId;
    playerId: string;
    displayName: string;
    socketId: string;
  }) {
    const player: RoomPlayer = {
      playerId: input.playerId,
      displayName: input.displayName,
      socketIds: new Set([input.socketId]),
    };
    let code = randomCode();

    while ([...this.rooms.values()].some((room) => room.code === code)) {
      code = randomCode();
    }

    const room: Room = {
      id: randomId("room"),
      code,
      gameId: input.gameId,
      players: [player],
      state: this.createInitialState(input.gameId, [
        { playerId: player.playerId, displayName: player.displayName },
      ]),
      createdAt: new Date(),
    };

    this.rooms.set(room.id, room);

    return room;
  }

  joinRoom(input: {
    roomCode: string;
    playerId: string;
    displayName: string;
    socketId: string;
  }) {
    const room = [...this.rooms.values()].find(
      (candidate) => candidate.code === input.roomCode.toUpperCase(),
    );

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    if (room.players.length >= this.maxPlayers(room.gameId)) {
      throw new BadRequestException("Room is full");
    }

    const existing = room.players.find(
      (player) => player.playerId === input.playerId,
    );

    if (existing) {
      existing.socketIds.add(input.socketId);
    } else {
      room.players.push({
        playerId: input.playerId,
        displayName: input.displayName,
        socketIds: new Set([input.socketId]),
      });
    }

    room.state = this.syncPlayers(room);

    return room;
  }

  leaveRoom(roomId: string, playerId: string, socketId: string) {
    const room = this.getRoom(roomId);
    const player = room.players.find(
      (candidate) => candidate.playerId === playerId,
    );

    if (player) {
      player.socketIds.delete(socketId);
    }

    return room;
  }

  disconnectSocket(socketId: string) {
    for (const room of this.rooms.values()) {
      for (const player of room.players) {
        player.socketIds.delete(socketId);
      }
    }
  }

  setReady(roomId: string, playerId: string, ready: boolean) {
    const room = this.getRoom(roomId);
    room.state = this.applyAction(room, { type: "set-ready", playerId, ready });
    return room;
  }

  async belotTrumpDecision(
    roomId: string,
    playerId: string,
    decision:
      | { kind: "pass" }
      | { kind: "accept-upcard" }
      | { kind: "choose-suit"; suit: Suit },
  ) {
    const room = this.getRoom(roomId);
    this.ensureBelotRoom(room);

    if (decision.kind === "pass") {
      room.state = await this.applyActionAndPersist(room, {
        type: "trump-pass",
        playerId,
      });
    } else if (decision.kind === "accept-upcard") {
      room.state = await this.applyActionAndPersist(room, {
        type: "trump-accept-upcard",
        playerId,
      });
    } else {
      room.state = await this.applyActionAndPersist(room, {
        type: "trump-choose-suit",
        playerId,
        suit: decision.suit,
      });
    }

    return room;
  }

  async belotDeclare(
    roomId: string,
    playerId: string,
    declarations: BelotDeclaration[],
  ) {
    const room = this.getRoom(roomId);
    if (room.state.gameId !== "belot") {
      throw new BadRequestException(
        "Belot action is not supported for this game",
      );
    }

    if (
      room.state.phase !== "declarations" ||
      Object.prototype.hasOwnProperty.call(
        room.state.declarationsByPlayer,
        playerId,
      )
    ) {
      return room;
    }

    room.state = await this.applyActionAndPersist(room, {
      type: "declare",
      playerId,
      declarations,
    });
    return room;
  }

  async belotPlayCard(roomId: string, playerId: string, cardId: string) {
    const room = this.getRoom(roomId);
    this.ensureBelotRoom(room);
    room.state = await this.applyActionAndPersist(room, {
      type: "play-card",
      playerId,
      cardId,
    });
    return room;
  }

  async belotNextHand(roomId: string) {
    const room = this.getRoom(roomId);
    this.ensureBelotRoom(room);
    room.state = await this.applyActionAndPersist(room, { type: "next-hand" });
    return room;
  }

  restart(roomId: string) {
    const room = this.getRoom(roomId);
    room.state = this.applyAction(room, { type: "restart" });
    room.persistedMatchId = undefined;
    return room;
  }

  getRoom(roomId: string) {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    return room;
  }

  publicRoomState(room: Room): RoomPublicState {
    return {
      id: room.id,
      code: room.code,
      gameId: room.gameId,
      players: room.players.map((player) => {
        const statePlayer = room.state.players.find(
          (candidate) => candidate.playerId === player.playerId,
        );

        return {
          playerId: player.playerId,
          displayName: player.displayName,
          connected: player.socketIds.size > 0,
          ready: Boolean(statePlayer?.ready),
        };
      }),
      phase: room.state.phase,
      createdAt: room.createdAt.toISOString(),
    };
  }

  publicGameState(room: Room, viewerPlayerId: string): GamePublicState {
    return getBelotPublicState(room.state, viewerPlayerId);
  }

  result(room: Room): GameResult {
    return {
      roomId: room.id,
      ...belotResult(room.state),
    };
  }

  metadata() {
    return listGames();
  }

  private async persistFinishedMatch(room: Room) {
    if (room.persistedMatchId) {
      return;
    }

    const result = this.result(room);
    const match = await this.matchesService.createCompletedMatch({
      gameId: room.gameId,
      roomCode: room.code,
      startedAt: new Date(room.state.createdAt),
      finishedAt: room.state.finishedAt
        ? new Date(room.state.finishedAt)
        : new Date(),
      result: {
        winnerPlayerIds: result.winnerPlayerIds,
        tied: result.tied,
        players: (result as BelotResult).players.map((player) => ({
          playerId: player.playerId,
          outcome: player.outcome,
          score: player.score,
        })),
      },
    });
    room.persistedMatchId = match.id;
  }

  private createInitialState(gameId: GameId, players: PlayerRef[]) {
    return createBelotInitialState(players);
  }

  private maxPlayers(gameId: GameId) {
    return belotDefinition.maxPlayers;
  }

  private syncPlayers(room: Room) {
    const players = room.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
    }));

    return applyBelotAction(room.state, { type: "sync-players", players });
  }

  private applyAction(room: Room, action: RoomGameAction) {
    return applyBelotAction(room.state, action);
  }

  private async applyActionAndPersist(room: Room, action: RoomGameAction) {
    const wasFinished = belotDefinition.isFinished(room.state);
    const nextState = this.applyAction(room, action);
    const isFinished = belotDefinition.isFinished(nextState);

    room.state = nextState;

    if (!wasFinished && isFinished) {
      await this.persistFinishedMatch(room);
    }

    return nextState;
  }

  private ensureBelotRoom(room: Room) {
    if (room.state.gameId !== "belot") {
      throw new BadRequestException(
        "Belot action is not supported for this game",
      );
    }
  }
}
