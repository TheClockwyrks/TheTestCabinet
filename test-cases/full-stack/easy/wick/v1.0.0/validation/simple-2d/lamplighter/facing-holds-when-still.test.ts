// lamplighter/facing-holds-when-still — facing holds while the lamplighter
// stands still.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "A tick with no
// horizontal component, whether the lamplighter is still or moving straight up
// or down, leaves facing as it was." With no movement key held the direction
// is the zero vector on every tick, so `facing` keeps whatever it held.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, so nothing on the field can move the
// lamplighter. `facing` is posed to "left" and read back, the value a fresh
// run does NOT start with, so a build that quietly re-derives facing from a
// zero direction, or resets it to the start value on an idle tick, is caught
// rather than agreed with; a surface that does not answer the pose fails the
// point here.
//
// WHAT IS READ, AND IN WHICH DIRECTION. `facing` on every one of the 60 idle
// ticks the item names. Only the STILL case is decided here; the vertical case
// is `facing-holds-on-vertical`. The last idle frame is kept as the still.
//
// TOLERANCE. None: `facing` is one of two strings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** Idle ticks watched: one second, the count the item names. */
const IDLE_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps facing left across 60 ticks with no movement key held", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the ticks run on");
  h.debug.setFacing("left");
  assertEqual(
    h.snapshot().run.player.facing,
    "left",
    "facing as posed, read back through the surface",
  );

  const seen = await h.trace(IDLE_TICKS);
  captureStill(h, "still");

  assertLength(seen, IDLE_TICKS, "idle ticks traced");
  seen.forEach((snapshot, i) => {
    assertEqual(
      snapshot.run.player.facing,
      "left",
      `facing on idle tick ${i + 1}`,
    );
  });
});
