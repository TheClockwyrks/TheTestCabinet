// scoring/edge-hit-scores-50-on-survival — a surviving edge hit awards 50.
//
// specs/scoring.md: "A face hit and an edge hit award alike, and a hit awards
// exactly one row: the `50` while the target survives, its ring's destroy figure
// when it destroys." This point is the surviving row; the destroying row is
// `edge-destroy-awards-the-ring-figure`, so a build that pays the wrong figure
// on one of the two loses one point rather than both.
//
// THE CROSSING IS THE EDGE CROSSING OF specs/rings.md — the ball's radius stays
// inside the ring's contact band while its center angle crosses into the arc —
// so the award read here rode an edge hit and nothing else. Ring 2 is used
// because its full hit points are `2`, so this hit leaves the target alive.
//
// THE WORLD IS ONE TARGET AND ONE BALL, gliding tangentially at the ring's mid
// radius from just past the arc's +theta edge. The ring is held still, and
// isolate holds both driver switches off.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertTrue } from "../assert";
import { HIT_SCORE } from "../constants";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  CARRIED,
  SWEEP_TICKS,
  armTarget,
  ballAtEdgeGate,
  fullHp,
  scored,
  stageCarried,
} from "./pose";

const RING = 2; // full hit points 2: this edge hit leaves the target alive
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("awards exactly 50 for an edge hit its target survives", async () => {
  await stageCarried(h);
  await armTarget(h, RING, SLOT, fullHp(RING));
  await ballAtEdgeGate(h, RING, SLOT);

  const swept = await captureReplay(h, "edge-hit", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + HIT_SCORE,
    "the surviving edge hit's award",
  );
  const target = swept.snapshot.rings[RING - 1].targets.find(
    (t) => t.slot === SLOT,
  );
  assertDefined(target, "the target survives the edge hit");
});
