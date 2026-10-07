// lamplighter/facing-holds-when-still — a lamplighter standing still keeps
// its facing.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "A tick with no
// horizontal component, whether the lamplighter is still or moving straight up
// or down, leaves `facing` as it was." With no movement key held the movement
// direction is the zero sum, so every tick leaves `facing` where it stood. The
// posed value is `"left"`, the one a fresh run does not start with, so a build
// that recomputes facing from a zero direction and falls back to its default
// is caught rather than agreed with. The figure is a string the specification
// fixes exactly, so there is no tolerance to state.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin,
// every driver switch off, nothing alive, and no key down, for `STILL_TICKS`
// (`60`) ticks, a second of standing still. `facing` is posed to `"left"`
// through the surface (specs/instrumentation.md, `setFacing`).
//
// WHAT IS READ. `facing` on every one of the sixty ticks, so the still that is
// captured after the last shows the figure the whole second held.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  player,
  type Harness,
} from "../harness";

/** One second of standing still, read one tick at a time. */
const STILL_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps facing left across a second with no movement key held", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("left");
  const posed = await h.snapshot();
  assertEqual(player(posed).facing, "left", "facing as posed");

  const ticks = await h.stepWatching(STILL_TICKS);
  await captureStill(h, "still");

  assertEqual(ticks.length, STILL_TICKS, "the frames stepped");
  ticks.forEach((snapshot, i) => {
    assertEqual(
      snapshot.screen,
      "playing",
      `the screen on tick ${i + 1} of standing still`,
    );
    assertEqual(
      player(snapshot).facing,
      "left",
      `facing on tick ${i + 1} of standing still`,
    );
  });
  assertEqual(
    player(ticks[STILL_TICKS - 1]!).x,
    player(opened).x,
    "player.x after the second, so the lamplighter stood still",
  );
});
