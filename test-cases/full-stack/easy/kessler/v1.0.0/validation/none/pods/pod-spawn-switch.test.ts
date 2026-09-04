// pods/pod-spawn-switch — with podSpawn off a destruction makes no draw and
// the stream is not consumed; turned back on, draws resume with no catching up.
//
// specs/instrumentation.md on the podSpawn switch: "No draw is made and the
// generator is not consumed, so no pod spawns and the seeded sequence stays
// where it stands." Under mulberry32(8) the stream opens 0.1563 (shed) then
// 0.6252 (shield): two destructions run with the switch off shed nothing, and
// the first destruction after the switch returns must shed exactly one pod of
// the kind the UNTOUCHED stream's first draw picks — shield. A build that
// consumed values while the switch was off reads 0.3007 (or later) as its next
// u1 and sheds nothing; one that queued the suppressed draws sheds more than
// one pod. The seed is chosen so both misalignments are visible.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DRAW, staged by the shared draw
// helper on a frozen ring 1 with the deflector parked away; isolate itself
// holds podSpawn off, which is the posture the first two destructions run in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { POD_DROP_CHANCE, mulberry32, podKindFor } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { AWAY_ANGLE, destroyPosedTarget } from "./draw";

/** mulberry32(8): 0.1563 (shed), 0.6252 (shield), 0.3007, 0.6957, 0.5852. */
const SEED = 8;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the draw and the stream while off, resumes in place", async () => {
  const next = mulberry32(SEED);
  const u1 = next();
  const u2 = next();
  const u3 = next();
  next(); // u4
  const u5 = next();
  // The scenario's own premises, from the specification's generator.
  assertTrue(u1 < POD_DROP_CHANCE, "the stream's first draw sheds");
  assertTrue(u3 >= POD_DROP_CHANCE, "a one-value-per-destruction leak shows");
  assertTrue(u5 >= POD_DROP_CHANCE, "a whole-draw-per-destruction leak shows");

  await isolate(h, SEED); // podSpawn held off by the isolate pose
  await h.debug.setPaddleAngle(AWAY_ANGLE);

  const off1 = await destroyPosedTarget(h, 1, 0);
  assertLength(off1.pods, 0, "no draw while the switch is off");
  const off2 = await destroyPosedTarget(h, 1, 1);
  assertLength(off2.pods, 0, "still no draw while the switch is off");

  await h.debug.setPodSpawn(true);
  const resumed = await captureReplay(h, "resumed-draw", () =>
    destroyPosedTarget(h, 1, 2),
  );
  assertLength(
    resumed.pods,
    1,
    "the next destruction draws once — no catching up",
  );
  assertEqual(
    resumed.pods[0].kind,
    podKindFor(u2),
    "the resumed draw reads the stream exactly where it stood",
  );
});
