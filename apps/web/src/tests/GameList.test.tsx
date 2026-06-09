import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GameList } from "../components/GameList";

describe("GameList", () => {
  it("renders GreaterCard", () => {
    render(
      <GameList
        games={[
          {
            id: "greater-card",
            displayName: "GreaterCard",
            description:
              "Each player draws one Hungarian card. Highest rank and suit wins.",
            minPlayers: 2,
            maxPlayers: 8,
          },
        ]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("GreaterCard")).toBeInTheDocument();
  });
});
