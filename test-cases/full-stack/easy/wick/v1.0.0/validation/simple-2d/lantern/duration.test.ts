// Wick — lantern/duration: the lanterns vanish on the tick their ttl is due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"): "each is a zone with `ttl` set to
//     `duration`" and "The lanterns vanish on the tick their `ttl` is due";
//     row 1 has duration `3.0`.
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a `ttl`
//     of `3.0` set on the firing tick is due `round(180.0) = 180` ticks
//     later.
//   - `specs/world.md` ("One tick"), phase 6: "Every projectile and zone that
//     existed before this tick counts its `ttl` down and is removed when it
//     is due", so the firing tick counts nothing and the lantern is present
//     after the 179th tick that follows it and gone after the 180th.
//   - `specs/instrumentation.md` (The driver switches): with `effectMotion`
//     off "`ttl` and every re-hit entry still count".
//
// WHAT IS READ. Whether the lantern the firing created is in `zones` after
// each of the 180 ticks following the firing: present after every tick
// through the 179th, gone after the 180th. A build removing the set a tick
// early fails on the 179th; one removing it a tick late fails on the 180th.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 1, one lantern, so
// which zone is watched is never in doubt; nothing on the field, so nothing
// else can remove or create a zone; every switch off but `weaponFire`, and
// `effectMotion` off holds the lantern still so the reading is its `ttl`
// alone.
//
// TOLERANCE. None: the rule fixes the tick to a whole count, and a build a
// tick out has broken the stated rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertUndefined } from "../assert";
import { ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  zoneById,
  type Harness,
} from "../harness";
import { armLantern, lanternRow, lanternsOf } from "./orbit";

/** The level this point holds Lantern at: one lantern. */
const LEVEL = 1;

/** Row 1 of LANTERN_LEVELS. */
const ROW = lanternRow(LEVEL);

/** The tick after the firing on which the ttl is due: round(3.0 × 60). */
const DUE_TICK = ticksFor(ROW.duration);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the level-1 lantern through the 179th tick after the firing and removes it on the 180th", async () => {
  assertEqual(ROW.amount, 1, "the level-1 row's amount");
  armLantern(h, LEVEL);

  const watched = await captureReplay(h, "vanished", async () => {
    const fired = await h.tick(1);
    const set = lanternsOf(fired);
    assertEqual(set.length, 1, "Lantern lanterns after the firing");
    return { id: set[0].id, seen: await h.trace(DUE_TICK) };
  });

  for (let tick = 1; tick < DUE_TICK; tick += 1) {
    assertDefined(
      zoneById(watched.seen[tick - 1], watched.id),
      `the lantern after tick ${tick} of ${DUE_TICK} since the firing`,
    );
  }
  assertUndefined(
    zoneById(watched.seen[DUE_TICK - 1], watched.id),
    `the lantern after tick ${DUE_TICK} since the firing, its ttl due`,
  );
});
