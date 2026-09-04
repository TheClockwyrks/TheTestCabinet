// screens/size-starts-the-expedition — choosing a size begins the expedition at
// once.
//
// specs/ui.md: on `size-select`, "a size begins the expedition in the mode chosen
// at `mode-select`". specs/expedition.md: "Starting it is a two-step choice: the
// mode, then the world size. Choosing a size begins the expedition at once", with
// the miner "standing on the camp ground at `SPAWN_COL`" and "the mine generated
// fresh from the current seed at the chosen size".
//
// SO ALL THREE SIZES ARE WALKED, from the mode choice through the size choice,
// and each arrival is read four ways: the screen is `in-mine`, the mode is the
// one chosen a screen earlier, `coreRow` is the one the chosen size fixes, and
// the miner is standing on the camp ground with a generated mine under it. The
// mine is read as generated rather than as empty by sampling a row well below the
// surface: generation leaves most of a row solid, an empty mine leaves none of it.
//
// ISOLATION. The mode choice reached directly through the surface for each pass,
// so a build with a broken title menu fails that check and passes this one, and
// each pass opens on a fresh `reset` so nothing carries between them.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  MODE_ITEMS,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SIZE_ITEMS,
  SURFACE_ROW,
  WORLD_SIZES,
  coreRowFor,
  type WorldSize,
} from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The mode each pass is played in, chosen a screen before the size. */
const MODE = "hardcore" as const;
const MODE_ENTRY = "HARDCORE" as const;

/** The row the mine is sampled at to say it was generated rather than left empty. */
const SAMPLE_ROW = 40;

/** How many of the sampled cells must be solid for the row to read as generated. */
const SOLID_MIN = 20;

/** Where each size sits on `SIZE_ITEMS`. */
const SIZE_INDEX: Readonly<Record<WorldSize, number>> = {
  quick: SIZE_ITEMS.indexOf("QUICK"),
  standard: SIZE_ITEMS.indexOf("STANDARD"),
  marathon: SIZE_ITEMS.indexOf("MARATHON"),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins the expedition at the chosen size, in the mode chosen before it", async () => {
  await h.debug.setAutoStep(false);

  for (const size of WORLD_SIZES) {
    await h.debug.reset();
    await h.debug.setScreen("mode-select");
    await h.debug.setMenuIndex(MODE_ITEMS.indexOf(MODE_ENTRY));
    await h.tap(ACTION_KEY.activate);
    await h.debug.setMenuIndex(SIZE_INDEX[size]);
    await h.tap(ACTION_KEY.activate);
    await h.advance(1);

    const started = await h.snapshot();
    if (size === "standard") await captureStill(h, "start");

    assertEqual(
      started.screen,
      "in-mine",
      `specs/ui.md: choosing ${size.toUpperCase()} begins the expedition at once`,
    );
    assertEqual(
      started.mode,
      MODE,
      "specs/ui.md: the expedition opens in the mode chosen at mode-select",
    );
    assertEqual(
      started.worldSize,
      size,
      `specs/ui.md: the expedition opens at the size chosen, ${size}`,
    );
    assertEqual(
      started.coreRow,
      coreRowFor(size),
      `specs/world.md: coreRow follows the chosen size, ${size}`,
    );
    assertLessThanOrEqual(
      started.miner.row,
      SURFACE_ROW,
      "specs/expedition.md: the miner starts standing on the camp ground",
    );
    assertEqual(
      started.miner.grounded,
      true,
      "specs/expedition.md: the miner starts standing rather than falling",
    );

    let solid = 0;
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
      if ((await h.tileAt(col, SAMPLE_ROW)).kind !== "tunnel") solid += 1;
    }
    assertGreaterThanOrEqual(
      solid,
      SOLID_MIN,
      `specs/expedition.md: the mine is generated fresh at ${size} rather than left empty`,
    );
  }
});
