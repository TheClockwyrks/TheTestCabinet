// instrumentation/next-crit-consumed-by-the-shot — the shot the arming is for is
// the one that spends it.
//
// `specs/instrumentation.md`: "That shot consumes the arming, and every shot
// after it rolls the stated chance again until the next call". Two readings fix
// the sentence at both ends. With nothing in range the tower launches nothing,
// so an arming has to survive a stretch of frames untouched; then a target is
// held inside its reach, the real systems fire the shot, and the arming has to be
// gone the moment that shot is in flight.
//
// WHAT THE SHOT DEALT is `combos/crit`'s point. This one reads the arming alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { comboDef, structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standCombo,
  structureById,
  ticks,
  type Harness,
} from "../harness";

const TOWER = comboDef("slagdriver");

/** Where the tower stands, clear of the Substation's chain. */
const ANCHOR = { col: 12, row: 12 };
/** Where the target is held: forty units off the tower's center. */
const TARGET = {
  x: structureCenter(ANCHOR.col, ANCHOR.row).x + 40,
  y: structureCenter(ANCHOR.col, ANCHOR.row).y,
};

/** How long the arming is left standing with nothing in range, in seconds. */
const IDLE = 1;

/** How long the shot is waited for, in seconds: several cadences of `0.6` /s. */
const PATIENCE = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the arming until a shot launches, and spends it on that shot", async () => {
  openYard(h);
  const id = standCombo(h, TOWER.id, ANCHOR.col, ANCHOR.row);
  h.debug.setNextCrit(id, true);

  await h.advanceSeconds(IDLE);
  assertEqual(
    structureById(h.snapshot(), id).nextCrit,
    true,
    `nextCrit after ${IDLE}s with nothing in range: no shot, so no consumption`,
  );

  parkUnit(h, "overload", TARGET);
  const fired = await captureReplay(h, "consumed", () =>
    h.until(
      (s) => s.projectiles.length > 0 || structureById(s, id).damageDealt > 0,
      { maxFrames: ticks(PATIENCE), poll: 1 },
    ),
  );
  assertEqual(
    fired.hit,
    true,
    `the ${TOWER.name} to launch a shot at the held target within ${PATIENCE}s`,
  );
  assertNull(
    structureById(fired.snapshot, id).nextCrit,
    "nextCrit once the armed shot is in flight (specs/instrumentation.md)",
  );
});
