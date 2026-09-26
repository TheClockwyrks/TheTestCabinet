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
import { assertBetween, assertEqual } from "../assert";
import { BAND_HEALTH, JETPACK_EMPTY_CLIMB, TILE } from "../constants";
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

/**
 * How far BELOW the ceiling's underside the box may come to rest, in world
 * units.
 *
 * One side of the face only. A build that advances, tests, and keeps the last
 * position clear of the ceiling comes to rest up to a whole frame of climb short
 * of it, and `specs/character.md` fixes no contact epsilon.
 * `specs/instrumentation.md` integrates every rate against the frame's delta, so
 * that frame is at most `JETPACK_EMPTY_CLIMB[0] / TICK_HZ` — the
 * tier-1 climb cap over one frame — and the band is the whole unit above it,
 * which is enough for the miner to have climbed the shaft and come to rest at
 * the ceiling rather than idled below it.
 *
 * Past the face there is no such slack to give. `specs/character.md`: "The
 * miner's box never overlaps a cell that is not a tunnel" — and no frame of
 * travel explains a box that has come to REST inside the ceiling, only a
 * collision box inset from the one the specification declares. So the band is
 * closed at the face, as every other contact reading in this case is. It is also
 * the only reading here that holds the box's top against a ceiling at all, so
 * opening it would leave that direction of the collision rule unread.
 */
const FLUSH = Math.ceil(JETPACK_EMPTY_CLIMB[0] / TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes nothing from the ceiling however long thrust is held", async () => {
  await openScene(h);
  await layFloor(h, ROW);
  await h.debug.setTile(COL, CEILING_ROW, "rock");
  await standOn(h, COL, ROW);

  const opening = await h.tileAt(COL, CEILING_ROW);
  assertEqual(opening.kind, "rock", "specs/instrumentation.md");
  assertEqual(opening.health, BAND_HEALTH.topsoil, "specs/world.md");

  const held = await captureReplay(h, "ceiling", async () => {
    await h.hold(ACTION_KEY.up);
    try {
      await h.advance(HOLD_FRAMES);
      return await h.snapshot();
    } finally {
      await h.release(ACTION_KEY.up);
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

  const after = await h.tileAt(COL, CEILING_ROW);
  assertEqual(after.kind, "rock", "specs/character.md");
  assertEqual(after.health, BAND_HEALTH.topsoil, "specs/character.md");
  assertEqual(held.miner.drilling, null, "specs/character.md");
});
