import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  applyGreaterCardAction,
  createGreaterCardInitialState,
  getGreaterCardPublicState,
  greaterCardDefinition,
  greaterCardResult,
  listGames,
  rankValue
} from "@card-games/game-core";
import type { GameId, GreaterCardPublicState, GreaterCardResult, RoomPublicState } from "@card-games/shared";
import { MatchesService } from "../matches/matches.service";
import type { Room, RoomPlayer } from "./rooms.types";

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

  createRoom(input: { gameId: GameId; playerId: string; displayName: string; socketId: string }) {
    if (input.gameId !== "greater-card") {
      throw new BadRequestException("Unsupported game");
    }

    const player: RoomPlayer = {
      playerId: input.playerId,
      displayName: input.displayName,
      socketIds: new Set([input.socketId])
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
      state: createGreaterCardInitialState([{ playerId: player.playerId, displayName: player.displayName }]),
      createdAt: new Date()
    };

    this.rooms.set(room.id, room);

    return room;
  }

  joinRoom(input: { roomCode: string; playerId: string; displayName: string; socketId: string }) {
    const room = [...this.rooms.values()].find((candidate) => candidate.code === input.roomCode.toUpperCase());

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    if (room.players.length >= greaterCardDefinition.maxPlayers) {
      throw new BadRequestException("Room is full");
    }

    const existing = room.players.find((player) => player.playerId === input.playerId);

    if (existing) {
      existing.socketIds.add(input.socketId);
    } else {
      room.players.push({
        playerId: input.playerId,
        displayName: input.displayName,
        socketIds: new Set([input.socketId])
      });
    }

    room.state = applyGreaterCardAction(room.state, {
      type: "sync-players",
      players: room.players.map((player) => ({ playerId: player.playerId, displayName: player.displayName }))
    });

    return room;
  }

  leaveRoom(roomId: string, playerId: string, socketId: string) {
    const room = this.getRoom(roomId);
    const player = room.players.find((candidate) => candidate.playerId === playerId);

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
    room.state = applyGreaterCardAction(room.state, { type: "set-ready", playerId, ready });
    return room;
  }

  async drawCard(roomId: string, playerId: string) {
    const room = this.getRoom(roomId);
    const wasFinished = greaterCardDefinition.isFinished(room.state);
    room.state = applyGreaterCardAction(room.state, { type: "draw-card", playerId });

    if (!wasFinished && greaterCardDefinition.isFinished(room.state)) {
      await this.persistFinishedMatch(room);
    }

    return room;
  }

  restart(roomId: string) {
    const room = this.getRoom(roomId);
    room.state = applyGreaterCardAction(room.state, { type: "restart" });
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
        const statePlayer = room.state.players.find((candidate) => candidate.playerId === player.playerId);

        return {
          playerId: player.playerId,
          displayName: player.displayName,
          connected: player.socketIds.size > 0,
          ready: Boolean(statePlayer?.ready)
        };
      }),
      phase: room.state.phase,
      createdAt: room.createdAt.toISOString()
    };
  }

  publicGameState(room: Room, viewerPlayerId: string): GreaterCardPublicState {
    return getGreaterCardPublicState(room.state, viewerPlayerId);
  }

  result(room: Room): GreaterCardResult {
    return {
      roomId: room.id,
      ...greaterCardResult(room.state)
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
      finishedAt: room.state.finishedAt ? new Date(room.state.finishedAt) : new Date(),
      result: {
        winnerPlayerIds: result.winnerPlayerIds,
        tied: result.tied,
        players: result.players.map((player) => ({
          playerId: player.playerId,
          outcome: player.outcome,
          card: player.card,
          score: player.card ? rankValue(player.card.rank) : undefined
        }))
      }
    });
    room.persistedMatchId = match.id;
  }
}
