// scoring/ring3-destroy-scores-300 — the hit that destroys a ring 3 target
// raises the score by exactly 300.
//
// specs/scoring.md's award table fixes "Destroying a ring 3 target" at
// `300`, and specs/rings.md fixes the event: "A hit that brings them to zero
// destroys the target: ... the ring's destroy score is awarded as
// specs/scoring.md fixes." The reading is the exact integer on the sweep's
// first score change — CARRIED + 300 — so a flat figure, another ring's
// figure, or a 50 stacked on top all fail on the same number.
//
// THE WORLD IS ONE TARGET AND ONE BALL. The target is posed at one hit point
// so this hit is the destroying one, the ring is held still, and isolate holds
// both driver switches off, so the destruction cannot cascade into a clearing
// bonus and no pod draw can follow it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { ringSpec } from "../constants";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  CARRIED,
  SWEEP_TICKS,
  armTarget,
  ballAtFaceGate,
  scored,
  stageCarried,
} from "./pose";

const RING = 3;
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("awards exactly 300 for the destroying hit", async () => {
  stageCarried(h);
  armTarget(h, RING, SLOT, 1);
  ballAtFaceGate(h, RING, SLOT);

  const swept = await captureReplay(h, "destroy", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + ringSpec(RING).destroyScore,
    "the score after the destroying hit",
  );
  assertLength(
    swept.snapshot.rings[RING - 1].targets,
    0,
    "the destroyed target removed",
  );
});
