import { Controller, Get } from "@nestjs/common";
import { listGames } from "@card-games/game-core";

@Controller("games")
export class GamesController {
  @Get()
  list() {
    return listGames();
  }
}
