// Wick — flare/burst-flash: the burst zone lasts `FLARE_FLASH`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"): "The burst is
// drawn for `FLARE_FLASH` (`0.4`) seconds", and the burst is a zone whose
// `ttl` is its "seconds left" (`specs/state.md`); ("Shapes and overlap") "a
// burst's `radius` is its Flare `radius`", which row 1 of `FLARE_LEVELS` gives
// as `640`, scaled by an `areaMul` of `1` with no passive held
// (`specs/passives.md`). `specs/world.md` ("Timers"): "a timer set to `s`
// seconds is due `round(s × TICK_HZ)` ticks after the tick it was set on",
// `round(0.4 × 60)` = `24`; and ("One tick", phase 6) "Every projectile and
// zone that existed before this tick counts its `ttl` down and is removed when
// it is due". So the zone reads radius `640` and `ttl` `0.4` on the tick it
// fires, is still in `zones` on the 23rd tick after it, with a tick's worth of
// `ttl` left, and is gone on the 24th.
//
// THE POSE. An isolated night with nothing alive, since a burst's life is not
// about what it hit, and Flare held at level 1 and fired through the shared
// `fireWeapon`. `weaponFire` is turned off after the firing so the
// twenty-four ticks that follow count the zone's `ttl` and nothing else, since
// a ttl counts whatever the switches hold (`specs/instrumentation.md`, "The
// driver switches"). The replay covers the firing tick and the twenty-four
// after it.
//
// TOLERANCE. `FLOAT_TOL` on the radius and `TIMER_TOL` on the `ttl` the firing
// tick set; presence on the 23rd tick and absence on the 24th are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertUndefined } from "../assert";
import {
  FLARE_FLASH,
  FLOAT_TOL,
  TICK_HZ,
  TIMER_TOL,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  mustZone,
  zoneById,
  type Harness,
} from "../harness";
import { FLARE, oneBurst } from "./stage";

/** The level fired; the flash is the same at every level. */
const LEVEL = 1;

/** Row 1's radius, `640`. */
const RADIUS = weaponRow(FLARE, LEVEL).radius!;

/** The ticks after the firing on which the zone is due: `round(0.4 × 60)`. */
const FLASH_TICKS = Math.round(FLARE_FLASH * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 640 and ttl 0.4 on the firing tick and is gone on the 24th tick after it", async () => {
  await isolate(h);

  const read = await captureReplay(h, "flash", async () => {
    const firing = await fireWeapon(h, FLARE, LEVEL);
    await disable(h, "weaponFire");
    const burst = oneBurst(firing.zones, "the firing tick");
    const ticks = await h.stepWatching(FLASH_TICKS);
    return { burst, ticks };
  });

  assertNear(
    read.burst.radius,
    RADIUS,
    FLOAT_TOL,
    "the burst's radius on the tick it fired",
  );
  assertNear(
    read.burst.ttl ?? NaN,
    FLARE_FLASH,
    TIMER_TOL,
    "the burst's ttl on the tick it fired",
  );
  const before = read.ticks[FLASH_TICKS - 2]!;
  mustZone(before, read.burst.id);
  const due = read.ticks[FLASH_TICKS - 1]!;
  assertUndefined(
    zoneById(due, read.burst.id),
    `the burst in zones on the ${FLASH_TICKS}th tick after the firing`,
  );
});
