// drilling/no-drill-up — the ceiling is solid.
//
// specs/character.md: the miner drills the tile it is moving into, down, left or
// right, and never upward, so the only way to ascend is the jetpack through
// tunnels already carved.
//
// The drill faculty stays ON here, because the point is that a running drill
// still removes nothing above the miner. The scene is a floor to stand on and a
// rock ceiling two cells up, with an open cell between, so the miner has room to
// lift off and then presses against the ceiling for the rest of the hold. Two
// seconds is sixteen `DRILL_HIT_INTERVAL`s, four times what a topsoil cell takes
// to break at tier 1.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH, TILE } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** The ceiling's row: two cells above the one the miner's box occupies. */
const CEILING_ROW = ROW - 3;

/** How long thrust is held against the ceiling, in frames. */
const HOLD_FRAMES = 2 * TICK_HZ;

/** How far the box may sit from the ceiling's underside, in world units. */
const FLUSH = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes nothing from the ceiling however long thrust is held", async () => {
  openScene(h);
  layFloor(h, ROW);
  h.debug.setTile(COL, CEILING_ROW, "rock");
  standOn(h, COL, ROW);

  const opening = h.tileAt(COL, CEILING_ROW);
  assertEqual(opening.kind, "rock", "specs/instrumentation.md");
  assertEqual(opening.health, BAND_HEALTH.topsoil, "specs/world.md");

  const held = await captureReplay(h, "ceiling", async () => {
    h.hold(ACTION_KEY.up);
    try {
      await h.advance(HOLD_FRAMES);
      return h.snapshot();
    } finally {
      h.release(ACTION_KEY.up);
    }
  });

  // The miner really did climb and come to rest against the ceiling, so the
  // hold pressed the drill into it rather than idling below it.
  assertBetween(
    held.miner.y,
    (CEILING_ROW + 1) * TILE,
    (CEILING_ROW + 1) * TILE + FLUSH,
    "specs/character.md",
  );

  const after = h.tileAt(COL, CEILING_ROW);
  assertEqual(after.kind, "rock", "specs/character.md");
  assertEqual(after.health, BAND_HEALTH.topsoil, "specs/character.md");
  assertEqual(held.miner.drilling, null, "specs/character.md");
});
