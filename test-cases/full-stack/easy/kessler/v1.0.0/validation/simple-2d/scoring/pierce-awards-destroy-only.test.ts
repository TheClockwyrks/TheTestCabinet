// scoring/pierce-awards-destroy-only — a piercing ball's target contact
// destroys outright and awards the destroy figure alone, whatever hit points
// the target held.
//
// specs/scoring.md: "A piercing ball's contact destroys outright, so it awards
// the destroy figure alone." specs/pods.md: "A piercing ball's target contact,
// face or edge, destroys the target outright whatever its hit points, awards
// the destroy score alone." The target is a ring 2 derelict at its FULL two
// hit points, so an unpierced build would award 50 here and a build that
// stacks the rows would award 250 — both fail on the exact CARRIED + 200.
//
// THE WORLD IS ONE TARGET AND ONE PIERCING BALL. pierce is put in force
// through the surface before the ball is spawned, the ring is held still, and
// isolate holds both driver switches off, so the outright destruction cannot
// cascade into a clearing bonus or a pod.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { DESTROY_SCORES, PIERCE_DURATION_TICKS } from "../constants";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  CARRIED,
  SWEEP_TICKS,
  armTarget,
  ballAtFaceGate,
  fullHp,
  scored,
  stageCarried,
} from "./pose";

const RING = 2;
const SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("awards the destroy figure alone on a piercing contact", async () => {
  stageCarried(h);
  armTarget(h, RING, SLOT, fullHp(RING));
  h.debug.setEffectTicks("pierce", PIERCE_DURATION_TICKS);
  ballAtFaceGate(h, RING, SLOT);
  const posed = h.snapshot();
  assertGreaterThan(posed.effects.pierceTicks, 0, "pierce in force");
  assertTrue(posed.balls[0].piercing, "the posed ball pierces");

  const swept = await captureReplay(h, "pierce", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + DESTROY_SCORES[RING - 1],
    "the destroy figure alone, with no 50 and no hit-point ladder",
  );
  assertLength(
    swept.snapshot.rings[RING - 1].targets,
    0,
    "the full-hit-point target destroyed outright",
  );
});
