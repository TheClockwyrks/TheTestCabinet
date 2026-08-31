// audio/one-cue-per-hit — the destroying hit plays target-break alone, never
// target-hit beside it.
//
// specs/rings.md separates the two cues by what the hit leaves behind — "A
// hit that leaves the target's hit points above zero plays the `target-hit`
// cue. A hit that brings them to zero destroys the target: ... the
// `target-break` cue plays" — and then closes the door this item guards: "A
// hit plays exactly one of the two cues."
//
// WHY THIS IS ITS OWN POINT. audio/target-hit-cue and audio/target-break-cue
// each decide one cue on its own event. This decides the tie between them: a
// build that plays target-hit on EVERY hit and layers target-break on top of
// the destroying one passes both of those and fails exactly here.
//
// THE DESTROYING HIT IS A DAMAGED RING 2 TARGET. The target is posed at 1 hit
// point on the ring whose full figure is 2 — the damaged state a real second
// hit arrives at — so a build that keys the cue on the ring or on the full
// figure rather than on the hit points remaining is caught too. The drive
// proves the destruction: the target live at 1 hit point after the lead
// ticks, gone after the crossing tick.
//
// THE POSE CROSSES STRICTLY. At 240 units per second the ball covers 4 units
// of radius per tick, so from radius 406 it reads 394 then 390 across ring
// 2's outer contact radius of 392 — no boundary reading. The ring is posed
// still and the ball aimed at the arc's center; isolate() holds both driver
// switches and empties everything else.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertLength,
  assertUndefined,
} from "../assert";
import { ballSpeedAtWave } from "../constants";
import {
  captureReplay,
  cuesNamed,
  isolate,
  onCue,
  openHarness,
  spawnBallPolar,
  targetArcCenterDeg,
  type Harness,
} from "../harness";
import { driveToEvent } from "./cues";

/** The two cues specs/rings.md lets a hit choose between. */
const BREAK_CUE = "target-break";
const HIT_CUE = "target-hit";

/** The posed target: ring 2, slot 0, damaged down to its last hit point. */
const RING = 2;
const SLOT = 0;
const LAST_HP = 1;

/** Posed start radius: 406 - 4 * 3 = 394 before the crossing tick, 390 after. */
const START_RADIUS = 406;

/** Ticks of plain inward flight before the destroying hit. */
const LEAD_TICKS = 3;

/** Ticks driven after the destruction, so the clip holds the aftermath. */
const TRAIL_TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays target-break alone on the destroying hit", async () => {
  isolate(h);
  h.debug.setRingSpeed(RING, 0);
  h.debug.spawnTarget(RING, SLOT, LAST_HP);
  spawnBallPolar(
    h,
    START_RADIUS,
    targetArcCenterDeg(RING, SLOT),
    -ballSpeedAtWave(1),
  );

  const cues = onCue(h);
  const drive = await captureReplay(h, "destroying-hit", () =>
    driveToEvent(h, cues, LEAD_TICKS, TRAIL_TICKS),
  );

  // The drive reached the destroying hit on the crossing tick and not before.
  const damaged = drive.before.rings[RING - 1].targets.find(
    (target) => target.slot === SLOT,
  );
  assertDefined(damaged, "the posed target after the lead ticks");
  assertEqual(
    damaged?.hp,
    LAST_HP,
    "the target's hit points after the lead ticks: still at its posed 1",
  );
  assertUndefined(
    drive.after.rings[RING - 1].targets.find((target) => target.slot === SLOT),
    "the target after the crossing tick: the hit destroyed it",
  );

  assertLength(
    cuesNamed(drive.quiet, BREAK_CUE),
    0,
    "target-break cues sounded before the destroying hit",
  );
  assertLength(
    cuesNamed(drive.quiet, HIT_CUE),
    0,
    "target-hit cues sounded before the destroying hit",
  );
  assertLength(
    cuesNamed(drive.played, BREAK_CUE),
    1,
    "target-break cues sounded by the end of the destroying hit's tick",
  );
  assertLength(
    cuesNamed(drive.played, HIT_CUE),
    0,
    "target-hit cues sounded on the destroying hit: the hit plays exactly " +
      "one of the two cues",
  );
});
