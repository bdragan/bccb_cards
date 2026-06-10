import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GameList } from "../components/GameList";

describe("GameList", () => {
  const games = [
    {
      id: "greater-card" as const,
      displayName: "GreaterCard",
      description:
        "Each player draws one Hungarian card. Highest rank and suit wins.",
      minPlayers: 2,
      maxPlayers: 8,
    },
    {
      id: "bellot" as const,
      displayName: "Bellot",
      description:
        "Two-player Belot with hidden pickup cards, client-submitted declarations, mus, fall scoring, and schuster penalties.",
      minPlayers: 2,
      maxPlayers: 2,
    },
  ];

  it("renders GreaterCard", () => {
    render(<GameList games={games} onSelect={vi.fn()} />);

    expect(screen.getByText("GreaterCard")).toBeInTheDocument();
  });

  it("marks the selected game and selects Bellot", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <GameList games={games} selectedGameId="bellot" onSelect={onSelect} />,
    );

    expect(screen.getByRole("button", { name: "Selected" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Selected" }));

    expect(onSelect).toHaveBeenCalledWith("bellot");
  });
});
