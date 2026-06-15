import { expect, test, type Browser, type Page } from "@playwright/test";

const password = "password123";

test("plays a complete Bellot game through the browser", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const runId = `${Date.now()}-${test.info().workerIndex}`;
  const playerOne = await newPlayer(browser, {
    email: `bellot-p1-${runId}@example.test`,
    displayName: "E2E Player One",
  });
  const playerTwo = await newPlayer(browser, {
    email: `bellot-p2-${runId}@example.test`,
    displayName: "E2E Player Two",
  });

  await register(playerOne);
  await register(playerTwo);

  await playerOne.getByRole("button", { name: "Create room" }).click();
  await expect(playerOne.getByRole("heading", { name: "Lobby" })).toBeVisible();

  const roomCode = (
    await playerOne.getByTestId("room-code").innerText()
  ).trim();

  await playerTwo.getByPlaceholder("Room code").fill(roomCode);
  await playerTwo.getByRole("button", { name: "Join" }).click();
  await expect(playerTwo.getByRole("heading", { name: "Lobby" })).toBeVisible();

  await playerOne.getByRole("button", { name: "Ready" }).click();
  await playerTwo.getByRole("button", { name: "Ready" }).click();
  await expect(playerOne.getByTestId("bellot-status")).toBeVisible();
  await expect(playerTwo.getByTestId("bellot-status")).toBeVisible();

  await chooseTrump([playerOne, playerTwo]);
  await playUntilFinished([playerOne, playerTwo]);

  await expect(playerOne.getByTestId("bellot-status")).toContainText(
    "Status: finished",
  );
  await expect(playerTwo.getByTestId("bellot-status")).toContainText(
    "Status: finished",
  );
  await expect(
    playerOne.getByText("Declarations are not currently open"),
  ).toHaveCount(0);
  await expect(
    playerTwo.getByText("Declarations are not currently open"),
  ).toHaveCount(0);

  await playerOne.context().close();
  await playerTwo.context().close();
});

async function newPlayer(
  browser: Browser,
  player: { email: string; displayName: string },
) {
  const context = await browser.newContext();
  const page = await context.newPage();

  Object.assign(page, player);

  return page;
}

async function register(page: Page) {
  const player = page as Page & { email: string; displayName: string };

  await page.goto("/");
  await page.getByRole("button", { name: "Register" }).click();
  await page.getByLabel("Email").fill(player.email);
  await page.getByLabel("Display name").fill(player.displayName);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("button", { name: "Create room" })).toBeVisible({
    timeout: 10_000,
  });
}

async function chooseTrump(players: Page[]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const player of players) {
      const acceptButton = player.getByRole("button", { name: /^Accept / });

      if (await acceptButton.isVisible().catch(() => false)) {
        await acceptButton.click();
        await expect(player.getByTestId("bellot-status")).toContainText(
          /Status: (declarations|trick play)/,
        );
        return;
      }
    }

    await players[0].waitForTimeout(100);
  }

  throw new Error("No player was prompted to choose trump");
}

async function playUntilFinished(players: Page[]) {
  for (let action = 0; action < 500; action += 1) {
    await assertNoDeclarationError(players);

    const status = await players[0].getByTestId("bellot-status").innerText();

    if (status.includes("finished")) {
      return;
    }

    if (status.includes("hand complete")) {
      await players[0].getByRole("button", { name: "Next hand" }).click();
      await chooseTrump(players);
      continue;
    }

    if (status.includes("declarations")) {
      await expect(players[0].getByTestId("bellot-status")).toContainText(
        "Status: trick play",
        { timeout: 10_000 },
      );
      continue;
    }

    if (status.includes("trick play")) {
      const currentPlayer = await playerWithPlayableCard(players);

      if (!currentPlayer) {
        continue;
      }

      const playableCard = currentPlayer
        .locator('[data-testid="bellot-hand-card"]:not([disabled])')
        .first();

      await expect(playableCard).toBeVisible({ timeout: 10_000 });
      if (
        !(await players[0].getByTestId("bellot-status").innerText()).includes(
          "trick play",
        )
      ) {
        continue;
      }

      await playableCard.dispatchEvent("click");
      continue;
    }

    if (status.includes("trump")) {
      await chooseTrump(players);
      continue;
    }

    throw new Error(`Unexpected Bellot status: ${status}`);
  }

  throw new Error("Bellot game did not finish within 500 player actions");
}

async function playerWithPlayableCard(players: Page[]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await players[0].getByTestId("bellot-status").innerText();

    if (!status.includes("trick play")) {
      return undefined;
    }

    for (const player of players) {
      const playableCards = player.locator(
        '[data-testid="bellot-hand-card"]:not([disabled])',
      );

      if ((await playableCards.count()) > 0) {
        return player;
      }
    }

    await players[0].waitForTimeout(100);
  }

  throw new Error("No playable card was available");
}

async function assertNoDeclarationError(players: Page[]) {
  for (const player of players) {
    await expect(
      player.getByText("Declarations are not currently open"),
    ).toHaveCount(0);
  }
}
