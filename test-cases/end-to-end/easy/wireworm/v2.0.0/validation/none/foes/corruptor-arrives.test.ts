// foes/corruptor-arrives — a corruptor arrives once the level gate opens.
//
// `specs/foes.md`: "From that level on, the corruptor's clock is drawn uniformly
// between CORRUPTOR_MIN_INTERVAL (14.0 s) and CORRUPTOR_MAX_INTERVAL (22.0 s),
// so a corruptor enters after such an interval timed from the moment the
// level's play becomes active."
//
// The bound the point holds a build to is the UPPER END of that range, because
// that is the part of it that holds for every draw: whatever the build draws,
// it draws below `CORRUPTOR_MAX_INTERVAL`, so a build that honours the pacing
// passes on any draw and a build that never spawns fails on every one. The
// clock is left to the build's own draw rather than posed, because the draw's
// range IS this point's requirement; `instrumentation/set-spawn-timer` is the
// point that poses it.
//
// The requirement this point decides IS the level's own spawning, so this is one
// of the few points that turns `setFoeSpawning` back on. Nothing else is posed:
// the board `startPlaying` leaves is empty and quiet. The glitch and dropper
// spawners run alongside it at this level — that is what `foeSpawning` gates —
// so the sweep looks for a CORRUPTOR alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_MIN_INTERVAL,
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

/** The level watched: the one corruptors begin at. */
const LEVEL = CORRUPTOR_FROM_LEVEL;

/**
 * How often the roster is read, in seconds. A corruptor crosses the board in
 * nearly ten seconds, so a half-second sample cannot step over the one this
 * sweep is waiting for.
 */
const POLL_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("brings a corruptor in within the longest interval the specification allows", async () => {
  await startPlaying(h, { level: LEVEL });
  await h.debug.setFoeSpawning(true);

  const arrival = await untilFoeOfKind(
    h,
    "corruptor",
    CORRUPTOR_MAX_INTERVAL,
    POLL_SECONDS,
  );

  await captureStill(h, "arrival");
  assertEqual(
    arrival.hit,
    true,
    `a corruptor joins the roster within CORRUPTOR_MAX_INTERVAL ` +
      `(${CORRUPTOR_MAX_INTERVAL} s) of level-${LEVEL} play, whatever the ` +
      `build drew from ${CORRUPTOR_MIN_INTERVAL} s up; the roster ` +
      `held ${foesOfKind(arrival.snapshot, "corruptor").length} corruptors ` +
      `when the sweep ran out`,
  );
});
