// scoring/destroy-awards-one-row — a hit awards exactly one row of the table:
// the 50 while the target survives, the destroy figure alone when it destroys.
//
// specs/scoring.md: "a hit awards exactly one row: the `50` while the target
// survives, its ring's destroy figure when it destroys." Both readings run on
// the same ring 2 derelict, whose two hit points give the pair: the first hit
// changes the score by exactly 50 and nothing more, and the second — the
// destroying one — by exactly 200, where 250 would be the destroy figure with
// the hit's 50 wrongly stacked on top.
//
// THE WORLD IS ONE TARGET AND, PER HIT, ONE BALL. The ring is held still, and
// isolate holds both driver switches off, so neither hit can cascade into a
// clearing bonus or a pod. The first ball is cleared once it has hit, so the
// second reading is one fresh approach.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { HIT_SCORE, ringSpec } from "../constants";
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

it("awards one row per hit: 50 surviving, the destroy figure alone destroying", async () => {
  stageCarried(h);
  armTarget(h, RING, SLOT, fullHp(RING));

  ballAtFaceGate(h, RING, SLOT);
  const first = await captureReplay(h, "first-hit", () =>
    h.until(scored(CARRIED), { maxTicks: SWEEP_TICKS }),
  );
  assertTrue(first.hit, "a first score change within the sweep");
  assertEqual(
    first.snapshot.score,
    CARRIED + HIT_SCORE,
    "the surviving hit's single row",
  );

  h.debug.clearBalls();
  ballAtFaceGate(h, RING, SLOT);
  const second = await captureReplay(h, "second-hit", () =>
    h.until(scored(CARRIED + HIT_SCORE), { maxTicks: SWEEP_TICKS }),
  );
  assertTrue(second.hit, "a second score change within the sweep");
  assertEqual(
    second.snapshot.score,
    CARRIED + HIT_SCORE + ringSpec(RING).destroyScore,
    "the destroying hit's single row — the destroy figure with no 50 on top",
  );
  assertLength(
    second.snapshot.rings[RING - 1].targets,
    0,
    "the destroyed target removed",
  );
});
