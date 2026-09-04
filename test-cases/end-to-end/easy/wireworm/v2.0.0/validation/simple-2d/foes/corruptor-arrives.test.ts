// foes/corruptor-arrives — a corruptor arrives once the level gate opens.
//
// specs/foes.md: "From that level on, a corruptor enters after an interval drawn
// from the run's seeded generator between CORRUPTOR_MIN_INTERVAL (14.0 s) and
// CORRUPTOR_MAX_INTERVAL (22.0 s), timed from the moment the level's play
// becomes active." The upper end of that interval is the bound this check holds
// the build to, and it holds for every seed: whatever the generator draws, it
// draws below CORRUPTOR_MAX_INTERVAL.
//
// The requirement IS the level's own spawning, so this is one of the few checks
// that turns `setFoeSpawning` back on. The glitch and dropper spawners run
// alongside it at this level — that is what `foeSpawning` gates — so the sweep
// looks for a corruptor alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { foesOfKind, untilFoeOfKind } from "./harness";

/** The level watched: the one corruptors begin at. */
const LEVEL = CORRUPTOR_FROM_LEVEL;

/** How often the roster is read: a twentieth of a second. */
const POLL_FRAMES = ticksFor(0.05);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings a corruptor in within the longest interval the spec allows", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);

  const arrival = await untilFoeOfKind(
    h,
    "corruptor",
    ticksFor(CORRUPTOR_MAX_INTERVAL),
    POLL_FRAMES,
  );
  captureStill(h, "arrival");

  assertEqual(
    arrival.hit,
    true,
    `a corruptor joins the roster within CORRUPTOR_MAX_INTERVAL ` +
      `(${CORRUPTOR_MAX_INTERVAL} s) of level-${LEVEL} play; the roster held ` +
      `${foesOfKind(arrival.snapshot, "corruptor").length} when the sweep ` +
      `ran out`,
  );
});
