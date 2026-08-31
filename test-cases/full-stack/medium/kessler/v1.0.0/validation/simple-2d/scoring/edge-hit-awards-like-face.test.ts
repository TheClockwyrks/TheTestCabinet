// scoring/edge-hit-awards-like-face — an edge hit awards exactly what a face
// hit does: 50 while the target survives, the destroy figure when it destroys.
//
// specs/scoring.md: "A face hit and an edge hit award alike, and a hit awards
// exactly one row: the `50` while the target survives, its ring's destroy
// figure when it destroys." Both readings stage the edge crossing of
// specs/rings.md — the ball's radius stays inside the ring's contact band
// while its center angle crosses into the arc — so the award read here rode an
// edge hit and nothing else.
//
// THE WORLD IS ONE TARGET AND ONE BALL, gliding tangentially at the ring's mid
// radius from just past the arc's +theta edge. The ring is held still, and
// isolate holds both driver switches off, so the destroying reading cannot
// cascade into a clearing bonus or a pod.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { DESTROY_SCORES, HIT_SCORE } from "../constants";
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

const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("awards exactly 50 for a surviving edge hit", async () => {
  const ring = 2; // full hit points 2: this edge hit leaves the target alive
  stageCarried(h);
  armTarget(h, ring, SLOT, fullHp(ring));
  ballAtEdgeGate(h, ring, SLOT);

  const swept = await captureReplay(h, "edge-hit", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + HIT_SCORE,
    "the surviving edge hit's award",
  );
  const target = swept.snapshot.rings[ring - 1].targets.find(
    (t) => t.slot === SLOT,
  );
  assertDefined(target, "the target survives the edge hit");
});

it("awards exactly the destroy figure for a destroying edge hit", async () => {
  const ring = 1; // one hit point: this edge hit destroys
  stageCarried(h);
  armTarget(h, ring, SLOT, fullHp(ring));
  ballAtEdgeGate(h, ring, SLOT);

  const swept = await captureReplay(h, "edge-destroy", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + DESTROY_SCORES[ring - 1],
    "the destroying edge hit's award",
  );
  assertLength(
    swept.snapshot.rings[ring - 1].targets,
    0,
    "the destroyed target removed",
  );
});
