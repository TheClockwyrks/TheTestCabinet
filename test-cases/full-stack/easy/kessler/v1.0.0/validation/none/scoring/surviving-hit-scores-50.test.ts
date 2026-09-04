// scoring/surviving-hit-scores-50 — a hit that leaves the target alive raises
// the score by exactly 50, on the tick the hit resolves.
//
// specs/scoring.md's award table fixes "A hit that leaves the target alive" at
// `50`, and: "Each award lands on the tick its event resolves." The reading is
// an exact integer on the sweep's first score change: CARRIED + 50 read back
// alongside the target still alive at one hit point ties the award to a
// surviving hit and to the resolving tick at once.
//
// THE WORLD IS ONE TARGET AND ONE BALL. The target is a ring 2 derelict at its
// full two hit points, so the hit cannot destroy; the ring is held still so
// the arc stays where it is posed; and isolate holds both driver switches off,
// so nothing else can score.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertTrue } from "../assert";
import { HIT_POINTS } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("awards exactly 50 on the tick a surviving hit resolves", async () => {
  await stageCarried(h);
  await armTarget(h, RING, SLOT, fullHp(RING));
  await ballAtFaceGate(h, RING, SLOT);

  const swept = await captureReplay(h, "hit", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );

  assertTrue(swept.hit, "a score change within the sweep");
  assertEqual(
    swept.snapshot.score,
    CARRIED + HIT_POINTS,
    "the score on the tick the hit resolved",
  );
  const target = swept.snapshot.rings[RING - 1].targets.find(
    (t) => t.slot === SLOT,
  );
  assertDefined(target, "the target survives the hit");
  assertEqual(target?.hp, fullHp(RING) - 1, "one hit point removed, not zero");
});
