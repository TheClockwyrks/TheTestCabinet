// lamplighter/facing-holds-on-vertical — facing holds through straight
// vertical movement.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "A tick with no
// horizontal component, whether the lamplighter is still or moving straight up
// or down, leaves facing as it was." With ArrowUp alone held the direction is
// (0, -1) on every tick (specs/world.md, "Movement"), whose horizontal
// component is zero, so `facing` keeps whatever it held while the lamplighter
// walks straight up.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. `facing` is posed to "left" and read
// back, the value a fresh run does NOT start with, so a build that takes a
// non-zero direction as a reason to re-derive facing, or that treats a vertical
// walk as facing right, is caught rather than agreed with; a surface that does
// not answer the pose fails the point here.
//
// WHAT IS READ, AND IN WHICH DIRECTION. `facing` on every one of HELD_TICKS
// ticks under a held ArrowUp. Whether the hold MOVED the lamplighter is
// `move-up`'s business; what is decided here, in one direction, is that a
// walk with no horizontal component leaves facing where it stood. The still
// case is `facing-holds-when-still`.
//
// TOLERANCE. None: `facing` is one of two strings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The first key specs/controls.md binds to `up`: ArrowUp. */
const KEY = BINDINGS.up[0];

/** Ticks the key is held: one second of straight vertical movement. */
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps facing left while ArrowUp alone is held", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the key is held on");
  h.debug.setFacing("left");
  assertEqual(
    h.snapshot().run.player.facing,
    "left",
    "facing as posed before the key, read back through the surface",
  );

  const seen = await captureReplay(h, "vertical", async () => {
    h.holdKey(KEY);
    try {
      return await h.trace(HELD_TICKS);
    } finally {
      h.releaseKey(KEY);
    }
  });

  assertLength(seen, HELD_TICKS, "ticks traced under the held key");
  seen.forEach((snapshot, i) => {
    assertEqual(
      snapshot.run.player.facing,
      "left",
      `facing on held tick ${i + 1} of ${KEY}`,
    );
  });
});
