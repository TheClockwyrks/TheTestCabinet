// extraction/extract-three — an insertion that completes a maximal same-charge
// run of three draws that run off the channel.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Runs": "A run is a set of
// consecutive cores of one segment that all carry the same charge... A maximal
// run of at least 3 cores is extracted by the two events below". And "Extraction
// on an insertion": "When an insertion resolves, take the maximal same-charge run
// containing the inserted core within that core's segment. That run is extracted
// on the same tick when it holds at least 3 cores. The extraction removes every
// core of the run at once". MIN_RUN is the case's name for that 3.
//
// THE POSE. One segment of halide, halide, cobalt on the straight top run, with
// the quota exhausted so the inlet delivers nothing into the scenario
// (specs/channel.md — "Emission": the inlet emits only "While the level's quota is
// not exhausted"), and the injector loaded with halide. specs/channel.md — "The
// train" — fixes what makes those three one segment: cores "whose arc positions
// differ by exactly SPACING (28 units)". The head sits at arc position 380, which
// specs/channel.md's polyline puts at (420, 40) — directly above the injector at
// (420, 330) — so the shot is released straight up the field.
//
// WHY THE VERDICT DOES NOT TURN ON WHICH HALIDE IS STRUCK, OR ON WHICH SIDE.
// specs/injector.md — "Insertion" — seats the core at the struck core's arc
// position, or one spacing behind it, and shifts "Every core whose arc position
// before the strike is at most p" back by the spacing. Seating ahead of the head,
// behind the head, or behind the second halide all leave the same three arc
// positions carrying halide with the cobalt one spacing further back. So this
// check reads the extraction rule alone; which side a core seats on belongs to
// insertion/insert-ahead and insertion/insert-behind.
//
// NO TOLERANCE IS NEEDED. The verdict is a count and a charge — three cores are
// off the channel or they are not — so nothing here is measured against a figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { MIN_RUN, OPENING_AIM } from "../constants";
import {
  captureReplay,
  charges,
  coreCount,
  createHarness,
  driveShot,
  fireAt,
  poseHall,
  spacedRun,
  type Harness,
} from "../harness";

/**
 * The head of the posed segment: arc position 380, which specs/channel.md's first
 * leg (from the inlet at `(40, 40)` along `+x`) puts at `(420, 40)`, straight
 * above the injector at `(420, 330)`.
 */
const HEAD_S = 380;

/** The pair that is one core short of a run, and the odd core behind them. */
const POSED = ["halide", "halide", "cobalt"] as const;

/** Ticks of the aftermath kept in the replay, so the clip shows the hall after. */
const AFTERMATH_TICKS = 30; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a completed run of three off the channel and leaves the odd core", async () => {
  await poseHall(h, {
    cores: spacedRun(HEAD_S, POSED),
    loaded: "halide",
  });
  const before = h.snapshot();
  assertEqual(coreCount(before), POSED.length, "the posed segment");

  fireAt(h, OPENING_AIM);
  const shot = await captureReplay(h, "extract", async () => {
    const resolved = await driveShot(h);
    await h.step(AFTERMATH_TICKS);
    return resolved;
  });

  // The shot resolved rather than still being in flight, so what follows reads
  // the tick the insertion landed on.
  assertTrue(shot.landed, "the fired core to reach the channel");
  // Three halide cores went, the cobalt stayed: exactly the maximal same-charge
  // run containing the inserted core, and nothing else.
  assertEqual(coreCount(shot.snapshot), POSED.length + 1 - MIN_RUN);
  assertDeepEqual(charges(shot.snapshot), ["cobalt"]);
});
