// screens/victory-play-again — PLAY AGAIN starts the expedition over.
//
// specs/ui.md, on the Victory screen's menu: `PLAY AGAIN` "starts a fresh
// expedition in the same mode and size".
//
// SO THREE READINGS OF ONE ROUTE. The game is back at `in-mine`, the mode is the
// mode the won expedition was played in, and the size is the size it was played
// at — one behavior, read through the three fields the sentence fixes.
//
// WHAT THE SCREEN DRAWS IS NOT DECIDED HERE. `screens/victory-screen` decides the
// summary and the menu copy, and `screens/victory-menu` decides the other entry,
// so a build that draws the menu and wires only one entry grades differently from
// one that wires neither.
//
// ISOLATION. A Hardcore expedition at the Quick size, neither of which a session
// opens at, so "the same mode and size" is a real reading rather than a default
// read back. The win is driven through the shared `driveVictory`.

import { afterEach, beforeEach, it } from "vitest";
import { VICTORY_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  coreRowFor,
  createHarness,
  type Harness,
} from "../harness";
import { driveVictory } from "./expedition";

/** Settings a session never opens at, so "the same" is a real reading. */
const MODE = "hardcore" as const;
const SIZE = "quick" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a fresh expedition in the same mode and size", async () => {
  await driveVictory(h, { mode: MODE, size: SIZE });

  h.debug.setMenuIndex(VICTORY_ITEMS.indexOf("PLAY AGAIN"));
  await h.tap(ACTION_KEY.activate);
  await h.advance(1);
  captureStill(h, "again");

  const again = h.snapshot();
  assertEqual(
    again.screen,
    "in-mine",
    "specs/ui.md: PLAY AGAIN starts a fresh expedition",
  );
  assertEqual(again.mode, MODE, "specs/ui.md: PLAY AGAIN keeps the same mode");
  assertEqual(
    again.worldSize,
    SIZE,
    "specs/ui.md: PLAY AGAIN keeps the same world size",
  );
  assertEqual(
    again.coreRow,
    coreRowFor(SIZE),
    "specs/world.md: coreRow follows the size the fresh expedition opened at",
  );
});
