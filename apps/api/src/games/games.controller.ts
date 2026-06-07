import { listGames } from "@card-games/game-core";
import { Controller, Get } from "@nestjs/common";

@Controller("games")
export class GamesController {
  @Get()
  list() {
    return listGames();
  }
}
