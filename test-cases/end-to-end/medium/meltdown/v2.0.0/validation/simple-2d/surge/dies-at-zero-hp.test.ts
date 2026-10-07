// surge/dies-at-zero-hp — a unit whose hp runs out leaves the roster on that
// frame.
//
// THE RULE. specs/surge.md's table of what removes a unit: "Its hp reached `0`"
// costs "Nothing", and specs/combat.md states it as a frame: "A unit's hp never
// falls below `0`, and a unit at `0` hp is removed on that frame."
//
// WHY THE DEATH IS DRIVEN AND NOT POSED. specs/instrumentation.md is explicit that
// `setUnitHp` "does not kill the unit: death belongs to the damage path", so the
// only way to reach this transition is to have something shoot the unit. The floor
// therefore holds one Arc and one mark and nothing else.
//
// THE MARK CARRIES ONE HP, THE LEAST A LIVE UNIT CAN, so the death follows from
// the shot LANDING rather than from any figure specs/combat.md gives the shot: a
// build whose fire rate or per-shot damage is off still takes a single hp away
// inside the window, and this point is about what happens when the hp runs out
// rather than about how fast it runs out. The Arc's thermal model is held, so the
// heat that scales its damage cannot move and no trip can interrupt the drive
// (specs/instrumentation.md), and the mark's locomotion is held, so it cannot walk
// out of range or reach an exhaust and leave the roster for the OTHER reason
// specs/surge.md gives — which would be a leak, and a different point entirely.
//
// WHY THE DRIVE IS A FRAME AT A TIME. "On that frame" is the whole content of the
// rule, and a sweep that only reports the roster emptying cannot tell a build that
// removes the unit on the frame its hp reached `0` from one that leaves a corpse
// at `0` hp standing until the next frame, or from one that leaves it standing for
// good. So every frame is looked at: while the mark is on the roster its hp must
// be above `0`, and the frame it drops off is the frame that decides the point.
//
// THE PHASE IS `building`, so the death cannot also clear a wave: specs/waves.md
// clears a wave only while the phase is `wave`. Nothing else can move while this
// runs.
//
// WHAT EVERY WRONG MODEL READS. A build that clamps hp at `0` and leaves the unit
// standing is caught by the hp reading on a frame the unit was still there; one
// that never removes it is caught by the roster never emptying; one that removes
// it a frame early would have to remove it while its hp was still positive, which
// the same reading catches.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  poseTarget,
  startRun,
  type Harness,
} from "../harness";
import { GUN, KILL_TICKS, MARK, MARK_HP } from "./roster";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the unit on the frame its hp reaches 0, and never before", async () => {
  startRun(h);
  posePinnedTower(h, "arc", GUN.col, GUN.row, 0);
  const mark = poseTarget(h, "mote", MARK.col, MARK.row, MARK_HP);

  let gone = false;
  for (let frame = 0; frame < KILL_TICKS && !gone; frame += 1) {
    await h.advance(1);
    const standing = h.snapshot().surge.find((unit) => unit.id === mark);
    if (standing === undefined) {
      gone = true;
      break;
    }
    // Read on every frame the mark was still there: a unit at `0` hp is gone, so
    // one that is present is one whose hp has not run out.
    assertGreaterThan(
      standing.hp,
      0,
      `frame ${frame + 1}: the hp of a unit still on the roster`,
    );
  }

  captureStill(h, "death");

  assertTrue(
    gone,
    "the mark left the roster once the Arc's shot took its one hp",
  );
});
