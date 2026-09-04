// foes/glitch-arrives — a glitch arrives once the level gate opens.
//
// specs/foes.md: "From that level on, a glitch enters after an interval drawn
// from the run's seeded generator between GLITCH_MIN_INTERVAL (7.0 s) and
// GLITCH_MAX_INTERVAL (12.0 s), timed from the moment the level's play becomes
// active." The upper end of that interval is the bound this check holds the
// build to, and it holds for every seed: whatever the generator draws, it draws
// below GLITCH_MAX_INTERVAL.
//
// The requirement IS the level's own spawning, so this is one of the few checks
// that turns `setFoeSpawning` back on. Nothing else is posed: the board
// `startPlaying` leaves is empty and quiet, so a glitch on it is one the level
// brought in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GLITCH_FROM_LEVEL, GLITCH_MAX_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { foesOfKind, untilFoeOfKind } from "./harness";

/** The level watched: the one the glitches begin at. */
const LEVEL = GLITCH_FROM_LEVEL;

/** How often the roster is read: a twentieth of a second. */
const POLL_FRAMES = ticksFor(0.05);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings a glitch in within the longest interval the spec allows", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);

  const arrival = await untilFoeOfKind(
    h,
    "glitch",
    ticksFor(GLITCH_MAX_INTERVAL),
    POLL_FRAMES,
  );
  captureStill(h, "arrival");

  assertEqual(
    arrival.hit,
    true,
    `a glitch joins the roster within GLITCH_MAX_INTERVAL ` +
      `(${GLITCH_MAX_INTERVAL} s) of level-${LEVEL} play; the roster held ` +
      `${foesOfKind(arrival.snapshot, "glitch").length} when the sweep ran out`,
  );
});
