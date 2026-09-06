// channel/seed-layout — the twelve a level opens with are spaced along the
// channel from the inlet out to arc distance 308.
//
// THE SPEC LINE. `specs/channel.md`, "The seeded cores": "A level starts with
// `12` cores already on the channel, the head at `s = 308` and the tail at
// `s = 0`, spaced by `SPACING`." `SPACING` is 28 ("arc positions differ by
// exactly `SPACING` (`28` units)"), and 308 is 11 x 28 out from the inlet, so
// the three readings below are one statement: the tail sits at the inlet, the
// head eleven gaps ahead of it, and every consecutive pair exactly one gap
// apart. The snapshot reports the train "head first", so a gap is one entry's
// `s` less the next one's.
//
// THE TOLERANCE. +/- 0.5 units on every arc position, the case's standing
// tolerance for an arc position. The figures are placements rather than
// integrations — nothing has been stepped when they are read — so a conformant
// build lands on them exactly; the half unit is there for a build that keeps its
// positions rounded, and it is far tighter than any wrong spacing (a build
// spacing by a core diameter of 28 units either way, or seeding from the head
// backwards, is out by whole units).
//
// HOW MANY cores the channel opens with is `channel/seeded-twelve`'s point, not
// this one's, so nothing here asserts a count: this reads the layout of whatever
// the level put on the channel. A build that seeded the wrong number still
// fails here through the head, since the head of a short run does not stand at
// 308.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ARC_TOL, SEED_HEAD_S, SEED_TAIL_S, SPACING } from "../constants";
import {
  arcPositions,
  captureStill,
  createHarness,
  head,
  tail,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the twelve from the inlet out to 308, spaced by 28", async () => {
  await h.debug.startLevel(1);
  const opened = await h.snapshot();

  // The evidence, after the reading: `step` runs "the full tick followed by a
  // render" (`specs/instrumentation.md`), so one tick is what puts the opened
  // level on the canvas, and the layout above was read before it ran.
  await h.step(1);
  await captureStill(h, "opening");

  assertNear(
    tail(opened).s,
    SEED_TAIL_S,
    ARC_TOL,
    "the tail's arc position as a level opens",
  );
  assertNear(
    head(opened).s,
    SEED_HEAD_S,
    ARC_TOL,
    "the head's arc position as a level opens",
  );

  const arcs = arcPositions(opened);
  for (let i = 1; i < arcs.length; i += 1) {
    assertNear(
      arcs[i - 1] - arcs[i],
      SPACING,
      ARC_TOL,
      `the gap between opening cores ${i - 1} and ${i}`,
    );
  }
});
