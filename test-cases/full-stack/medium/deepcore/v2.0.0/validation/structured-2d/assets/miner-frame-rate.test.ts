// assets/miner-frame-rate — the cycle advances at the rate the contract states.
//
// `specs/assets.md`: "The game plays the cycle matching the miner's current state,
// advancing frames at `ANIM_FPS` (`12`) frames per second". `specs/overview.md`
// makes every rate in the specification a rate per second of the game's own
// elapsed time, integrated against the delta each update is handed, so the clock
// this is measured against is the one the harness drives.
//
// WHAT IS MEASURED, AND WHY IT IS THE SHORTEST HOLD. The miner is held idle and
// the pixels over its box are read on every frame of a second of game time; each
// run of identical readings is one drawn frame being held. A cycle is free to come
// back on itself — `A, B, A` holds `A` for two of the three — so the average hold
// says as much about the cycle's shape as about its rate. The SHORTEST hold does
// not: whatever the cycle, a frame that differs from the one after it is held for
// exactly one interval, and that interval is `1 / ANIM_FPS`.
//
// The scene is a cleared mine with a laid floor, the miner still and its drill
// held, so nothing but the cycle can move a pixel inside its box: no particles, no
// other actor, and a camera that has been let settle before the window opens. The
// idle state is the one with no effect attached to it.

import { afterEach, beforeEach, it } from "vitest";
import { ANIM_FPS } from "../constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  TICK_HZ,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { holds, sampleBox } from "./drawn";
import { SAMPLE_HZ, minerBox, showMiner } from "./miner";

/** The span the cycle is watched over, in seconds. */
const WATCH_SECONDS = 1;

/** Frames the camera is let settle over before the window opens. */
const SETTLE = 120;

/** How far the measured hold may sit from the stated one, as a share of it. */
const TOLERANCE = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds each drawn miner frame for one interval of ANIM_FPS", async () => {
  await showMiner(h, "idle");
  await h.advance(SETTLE);
  const box = minerBox(h);

  const watched = await captureReplay(h, "cycle", async () => {
    const readings: number[][] = [];
    for (let sample = 0; sample < WATCH_SECONDS * SAMPLE_HZ; sample += 1) {
      await h.advance(1);
      readings.push(sampleBox(h, box));
    }
    return { readings, state: h.snapshot().miner.state };
  });

  // The first and last runs are cut off by the window rather than by the cycle,
  // so what is measured is the runs the window holds whole.
  const runs = holds(watched.readings).slice(1, -1);
  const shortest = Math.min(...runs);
  const expected = TICK_HZ / ANIM_FPS;

  assertEqual(watched.state, "idle", "specs/character.md");
  assertGreaterThan(
    runs.length,
    0,
    "the idle cycle advances (specs/assets.md)",
  );
  assertBetween(
    shortest,
    expected * (1 - TOLERANCE),
    expected * (1 + TOLERANCE),
    "frames per drawn miner frame at ANIM_FPS (specs/assets.md)",
  );
});
