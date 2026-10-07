// Wick — taper/slash-flash: a slash zone holds `SLASH_FLASH` as its ttl and
// is removed on the tick that ttl is due.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "The slash is drawn for `SLASH_FLASH`
//     (`0.1`) seconds."
//   - `specs/state.md` (`ZoneState`, `ttl`): "the seconds the zone has left, a
//     timer as `specs/world.md` defines one ... A zone is removed on the tick
//     `ttl` is due. A slash holds `SLASH_FLASH` (`0.1`)".
//   - `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
//     `round(s × TICK_HZ)` ticks after the tick it was set on", so a ttl of
//     0.1 is due 6 ticks after the firing tick.
//   - `specs/world.md` ("One tick", phase 6): "Every projectile and zone that
//     existed before this tick counts its `ttl` down and is removed when it is
//     due", so the slash stands through the 5th tick after its firing and is
//     gone on the 6th.
//
// WHAT IS READ. The slash's `ttl` on its firing tick, 0.1; then the zone is
// followed by id across the six ticks after: present after each of the first
// five, absent after the sixth.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper alone at level 1 with every switch
// but `weaponFire` off, and nothing on the field, so the one slash is the only
// zone and nothing else is created or removed. Taper's timer is 1.35 after
// the firing, so no second slash arrives inside the six ticks.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the ttl reading, a stated figure
// read back; none on the tick count, which the spec states exactly through
// `round`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertUndefined,
  assertWithin,
} from "../assert";
import { FIGURE_TOLERANCE, SLASH_FLASH, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  zoneById,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper } from "./slash";

/** Ticks from the firing to the removal: round(0.1 × 60) = 6. */
const FLASH_TICKS = ticksFor(SLASH_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads ttl 0.1 on the firing tick and is gone on the 6th tick after", async () => {
  armTaper(h, 1, "right");

  const outcome = await captureReplay(h, "flash", async () => {
    const fired = await h.tick(1);
    const slashes = zonesOfKind(fired, "slash");
    const id = slashes[0]?.id;
    const following = await h.trace(FLASH_TICKS);
    return { fired, slashes, id, following };
  });

  assertEqual(outcome.slashes.length, 1, "slashes on the firing tick");
  const slash = outcome.slashes[0];
  assertWithin(
    slash.ttl ?? Number.NaN,
    SLASH_FLASH,
    FIGURE_TOLERANCE,
    "the slash's ttl on its firing tick",
  );
  assertDefined(outcome.id, "the slash's id");
  for (let tick = 1; tick < FLASH_TICKS; tick += 1) {
    assertDefined(
      zoneById(outcome.following[tick - 1], outcome.id),
      `the slash on the tick ${tick} after its firing`,
    );
  }
  assertUndefined(
    zoneById(outcome.following[FLASH_TICKS - 1], outcome.id),
    `the slash on the tick ${FLASH_TICKS} after its firing`,
  );
});
