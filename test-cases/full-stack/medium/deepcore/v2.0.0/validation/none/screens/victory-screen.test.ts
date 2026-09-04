// screens/victory-screen — the Victory screen carries the summary and its menu.
//
// specs/ui.md: the `victory` screen shows "The expedition summary, after the
// rocket launches", and its menu is `VICTORY_ITEMS`: `PLAY AGAIN` and `MENU`.
// specs/rocket.md: "Launching is the only way to win", and it "takes the game to
// the Victory screen".
//
// WHAT IS DRAWN, AND ONLY THAT. The screen carries a populated summary —
// specs/expedition.md fixes it as `null` until the expedition ends, so a summary
// that is there at all is the reading — and the menu is `VICTORY_ITEMS` and
// nothing else, read by its copy and by stepping the highlight until it wraps.
//
// WHERE THE TWO ENTRIES GO IS NOT DECIDED HERE. `screens/victory-play-again` and
// `screens/victory-menu` decide the two routes, one each, the way the pause menu's
// three entries are three points: a build that draws the menu and wires only one
// of its entries must grade differently from one that wires neither.
//
// ISOLATION. A Hardcore expedition at the Quick size, neither of which a session
// opens at, so a later check of "the same mode and size" has something real to
// read. The win is driven through the shared `driveVictory`, which installs the
// components through `setRocketInstalled` — no Credits, no material — and lifts
// off through the control that stands for the Launch Pad's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { VICTORY_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import { driveVictory, menuLength } from "../save/expedition";

/** Settings a session never opens at, so "the same" is a real reading. */
const MODE = "hardcore" as const;
const SIZE = "quick" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the expedition summary and the whole of VICTORY_ITEMS", async () => {
  const won = await driveVictory(h, { mode: MODE, size: SIZE });
  const calls = await h.frameCalls();
  await captureStill(h, "victory");

  assertNotNull(
    won.summary,
    "specs/ui.md: the Victory screen shows the expedition summary",
  );
  for (const item of VICTORY_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `specs/ui.md: the Victory screen draws ${item}`,
    );
  }
  assertEqual(
    await menuLength(h),
    VICTORY_ITEMS.length,
    "specs/ui.md: VICTORY_ITEMS is the whole of the menu",
  );
});
