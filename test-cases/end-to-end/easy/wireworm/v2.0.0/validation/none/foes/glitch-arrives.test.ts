// foes/glitch-arrives — a glitch arrives once the level gate opens.
//
// `specs/foes.md`: "From that level on, the glitch's clock is drawn uniformly
// between GLITCH_MIN_INTERVAL (7.0 s) and GLITCH_MAX_INTERVAL (12.0 s), so a
// glitch enters after such an interval timed from the moment the level's play
// becomes active."
//
// The bound the point holds a build to is the UPPER END of that range, because
// that is the part of it that holds for every draw: whatever the build draws,
// it draws below `GLITCH_MAX_INTERVAL`, so a build that honours the pacing
// passes on any draw and a build that never spawns fails on every one. The
// clock is left to the build's own draw rather than posed, because the draw's
// range IS this point's requirement; `instrumentation/set-spawn-timer` is the
// point that poses it.
//
// The requirement this point decides IS the level's own spawning, so this is one
// of the few points that turns `setFoeSpawning` back on. Nothing else is posed:
// the board `startPlaying` leaves is empty and quiet, so a glitch standing on it
// is one the level brought in, and at level 2 the other two spawners are still
// behind gates of their own.

import { afterEach, beforeEach, it } from "vitest";
import {
  GLITCH_FROM_LEVEL,
  GLITCH_MAX_INTERVAL,
  GLITCH_MIN_INTERVAL,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  foesOfKind,
  startPlaying,
  type Harness,
} from "../harness";
import { untilFoeOfKind } from "./watching";

/** The level watched: the one glitches begin at. */
const LEVEL = GLITCH_FROM_LEVEL;

/**
 * How often the roster is read, in seconds. A quarter of the shortest interval
 * a build may draw is four samples inside even the earliest arrival allowed.
 */
const POLL_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("brings a glitch in within the longest interval the specification allows", async () => {
  await startPlaying(h, { level: LEVEL });
  await h.debug.setFoeSpawning(true);

  const arrival = await untilFoeOfKind(
    h,
    "glitch",
    GLITCH_MAX_INTERVAL,
    POLL_SECONDS,
  );

  await captureStill(h, "arrival");
  assertEqual(
    arrival.hit,
    true,
    `a glitch joins the roster within GLITCH_MAX_INTERVAL ` +
      `(${GLITCH_MAX_INTERVAL} s) of level-${LEVEL} play, whatever the build ` +
      `drew from ${GLITCH_MIN_INTERVAL} s up; the roster held ` +
      `${foesOfKind(arrival.snapshot, "glitch").length} glitches when the ` +
      `sweep ran out`,
  );
});
