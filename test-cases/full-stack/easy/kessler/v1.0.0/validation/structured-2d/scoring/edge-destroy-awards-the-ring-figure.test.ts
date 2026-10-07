// scoring/edge-destroy-awards-the-ring-figure — a destroying edge hit awards its
// ring's destroy figure.
//
// specs/scoring.md: "A face hit and an edge hit award alike, and a hit awards
// exactly one row: the `50` while the target survives, its ring's destroy figure
// when it destroys." This point is the destroying row; the surviving row is
// `edge-hit-scores-50-on-survival`, so a build that pays the wrong figure on one
// of the two loses one point rather than both.
//
// THE CROSSING IS THE EDGE CROSSING OF specs/rings.md — the ball's radius stays
// inside the ring's contact band while its center angle crosses into the arc —
// so the award read here rode an edge hit and nothing else. Ring 1 is used
// because its targets hold one hit point, so this hit destroys.
//
// THE WORLD IS ONE TARGET AND ONE BALL, gliding tangentially at the ring's mid
// radius from just past the arc's +theta edge. isolate holds both driver
// switches off, so the destruction cannot cascade into a clearing bonus or a pod
// and add to the figure being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { ringSpec } from "../constants";
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

const RING = 1; // one hit point: this edge hit destroys
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("awards exactly the ring's destroy figure for a destroying edge hit", async () => {
  await stageCarried(h);
  await armTarget(h, RING, SLOT, fullHp(RING));
  await ballAtEdgeGate(h, RING, SLOT);

  const swept = await captureReplay(h, "edge-destroy", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + ringSpec(RING).destroyScore,
    "the destroying edge hit's award",
  );
  assertLength(
    swept.snapshot.rings[RING - 1].targets,
    0,
    "the destroyed target removed",
  );
});
