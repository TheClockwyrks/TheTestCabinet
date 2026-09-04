// targeting — the one arrangement all five priorities are read through.
//
// Not a check: vitest never collects a file that is not a `.test.ts`, and nothing
// here decides a review point. Every priority is one requirement in one direction
// and so has a suite of its own, but they all ask the same question — given these
// units in range, which one does the structure shoot — and they must all ask it
// the same way, or a difference between two of them would be a difference in how
// they were driven rather than in what the build chose.
//
// THE SHOOTER. One Scrap Capacitor, whose `100` radius comfortably holds every
// unit these suites pose, and whose `1.6` shots a second means the first shot
// arrives inside a second. Its priority is set BEFORE any unit exists, so no shot
// can be fired under the default on the way to the one being read.
//
// WHAT IS READ. The `targetId` the first projectile carries, which
// specs/instrumentation.md fixes as the unit the shot was launched at. The shot is
// caught on the frame it appears rather than at its impact, so what is read is the
// CHOICE the structure made rather than what it happened to hit.

import { assertEqual, assertTruthy } from "../assert";
import type { Targeting } from "../constants";
import {
  standComponent,
  ticks,
  type Harness,
  type StructureView,
} from "../harness";

/** The shooter's anchor. */
export const ANCHOR = { col: 10, row: 10 };

/** How long the first shot is waited for, in seconds. */
export const PATIENCE = 5;

/**
 * Stand the shooter and set its priority, with nothing on the yard to shoot at.
 *
 * The order matters: a priority set after a unit is standing there could be set
 * after a shot has already gone out under whatever the structure defaulted to.
 */
export async function standShooter(
  h: Harness,
  priority: Targeting,
): Promise<StructureView> {
  const id = await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  await h.debug.setTargeting(id, priority);
  const structure = (await h.snapshot()).structures.find((s) => s.id === id);
  assertTruthy(structure, `the shooter on the yard after standing it up`);
  assertEqual(
    (structure as StructureView).targeting,
    priority,
    "the priority the shooter was set to (specs/instrumentation.md)",
  );
  return structure as StructureView;
}

/** The unit the first shot out of the structure was launched at. */
export async function firstShotTarget(h: Harness): Promise<number | null> {
  const found = await h.until((s) => s.projectiles.length > 0, {
    maxFrames: ticks(PATIENCE),
    poll: 1,
  });
  assertEqual(
    found.hit,
    true,
    `a shot within ${PATIENCE}s, from a structure with units standing in range`,
  );
  return found.snapshot.projectiles[0]!.targetId;
}
