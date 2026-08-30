// extraction/no-extract-two — an insertion that completes a run of only two
// leaves every core where it is and scores nothing.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Runs": "A maximal run of at
// least 3 cores is extracted by the two events below", so a maximal run of two is
// not. specs/extraction.md — "Extraction on an insertion" says the same from the
// other side: the run containing the inserted core "is extracted on the same tick
// when it holds at least 3 cores". And "Score": an extraction "adds 10 x n x k to
// the score", so with no extraction there is nothing to add.
//
// THE OTHER SIDE OF THE THRESHOLD. extract-three grades three; this grades two.
// They are separate points because a build that extracts every pair is a
// different game rather than a slightly wrong one, and a single check could not
// say which way a build failed.
//
// THE POSE. The mirror of extract-three's: one segment of halide, cobalt, cobalt
// on the straight top run (specs/channel.md — cores "whose arc positions differ
// by exactly SPACING (28 units)"), the quota exhausted so the inlet delivers
// nothing (specs/channel.md — "Emission"), and the injector loaded with halide.
// The head sits at arc position 380, which specs/channel.md's polyline puts at
// (420, 40), straight above the injector at (420, 330).
//
// The seated halide therefore joins the one halide already there and no more.
// specs/injector.md — "Insertion" — makes the answer the same whichever side of
// the head it lands on: ahead of the head or behind it, the two halides end up
// consecutive and the two cobalt behind them, so the maximal halide run is two.
// The cobalt pair is likewise two, and in any case specs/extraction.md considers
// only "the maximal same-charge run containing the inserted core".
//
// NO TOLERANCE IS NEEDED. The verdict is a count and a score that either moved or
// did not; nothing is measured against a figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { OPENING_AIM } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  driveShot,
  fireAt,
  poseHall,
  spacedRun,
  type Harness,
} from "../harness";

/** The head of the posed segment, at `(420, 40)` on specs/channel.md's first leg. */
const HEAD_S = 380;

/** One halide for the shot to join, and a cobalt pair that is no run either. */
const POSED = ["halide", "cobalt", "cobalt"] as const;

/** Ticks of the aftermath kept in the replay, so the clip shows the train riding on. */
const AFTERMATH_TICKS = 30; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a run of two on the channel and awards nothing", async () => {
  await poseHall(h, {
    cores: spacedRun(HEAD_S, POSED),
    loaded: "halide",
  });
  const before = await h.snapshot();
  assertEqual(coreCount(before), POSED.length, "the posed segment");

  await fireAt(h, OPENING_AIM);
  const shot = await captureReplay(h, "stays", async () => {
    const resolved = await driveShot(h);
    await h.step(AFTERMATH_TICKS);
    return resolved;
  });

  // The shot resolved rather than still being in flight, so what follows reads
  // the tick the insertion landed on.
  assertTrue(shot.landed, "the fired core to reach the channel");
  // The seated core is on the channel and nothing left it.
  assertEqual(coreCount(shot.snapshot), POSED.length + 1);
  // "adds 10 x n x k to the score" applies to an extraction, and there was none.
  assertEqual(shot.snapshot.score, before.score);
});
