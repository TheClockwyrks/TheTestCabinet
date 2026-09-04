// screens/victory-screen — the Victory screen carries the summary and its menu.
//
// specs/ui.md: the `victory` screen shows "The expedition summary, after the
// rocket launches", and its menu is `VICTORY_ITEMS`: `PLAY AGAIN`, which "starts
// a fresh expedition in the same mode and size", and `MENU`. specs/rocket.md:
// "Launching is the only way to win", and it "takes the game to the Victory
// screen".
//
// THREE READINGS. The screen carries a populated summary — specs/gameplay.md
// fixes it as `null` until the expedition ends, so a summary that is there at all
// is the reading. The menu is `VICTORY_ITEMS` and nothing else, read by its copy
// and by stepping the highlight until it wraps. And `PLAY AGAIN` really does
// start an expedition, in the mode and at the size the won one was played in.
//
// ISOLATION. A Hardcore expedition at the Quick size, neither of which a session
// opens at, so "the same mode and size" is a real reading. The five components
// are posed through `setRocketInstalled`, which specs/instrumentation.md says
// costs no Credits and consumes no material, and the launch is the control that
// stands for the Launch Pad's. The miner's body and drill are gated, since a
// launch exercises neither.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENTS, VICTORY_ITEMS } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  coreRowFor,
  createHarness,
  drewText,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { menuLength } from "./expedition";

/** Settings a session never opens at, so "the same" is a real reading. */
const MODE = "hardcore" as const;
const SIZE = "quick" as const;

/** Seconds of game time the lift-off is given to reach the Victory screen. */
const LAUNCH_CEILING = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the summary and VICTORY_ITEMS, and PLAY AGAIN starts over", async () => {
  openScene(h, { mode: MODE, size: SIZE });
  pinMiner(h);
  pinDrill(h);

  h.debug.setRocketInstalled(ROCKET_COMPONENTS.length);
  h.debug.launch();

  let won = h.snapshot();
  for (
    let second = 0;
    second < LAUNCH_CEILING && won.screen !== "victory";
    second += 1
  ) {
    await h.advanceSeconds(1, 8);
    won = h.snapshot();
  }
  const calls = await h.frameCalls();
  captureStill(h, "victory");

  assertEqual(
    won.screen,
    "victory",
    "specs/rocket.md: launching takes the game to the Victory screen",
  );
  assertNotNull(
    won.summary,
    "specs/ui.md: the Victory screen shows the expedition summary",
  );
  assertEqual(
    won.summary?.componentsInstalled,
    ROCKET_COMPONENTS.length,
    "specs/gameplay.md: the summary counts the rocket components installed",
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

  h.debug.setMenuIndex(VICTORY_ITEMS.indexOf("PLAY AGAIN"));
  await h.tap(ACTION_KEY.activate);
  await h.advance(1);

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
