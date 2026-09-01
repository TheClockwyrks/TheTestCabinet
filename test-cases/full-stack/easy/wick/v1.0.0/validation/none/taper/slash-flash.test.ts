// Wick — taper/slash-flash: the slash zone lasts `SLASH_FLASH`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"): "The slash is
// drawn for `SLASH_FLASH` (`0.1`) seconds", and the slash is a zone whose
// `ttl` is its "seconds left" (`specs/state.md`). `specs/world.md` ("Timers"):
// "a timer set to `s` seconds is due `round(s × TICK_HZ)` ticks after the tick
// it was set on", `round(0.1 × 60)` = `6`; and ("One tick", phase 6) "Every
// projectile and zone that existed before this tick counts its `ttl` down and
// is removed when it is due". So the zone reads `ttl` `0.1` on the tick it
// fires, is still in `zones` on the 5th tick after it, with a tick's worth of
// `ttl` left, and is gone on the 6th.
//
// THE POSE. Taper at level 1 fires on an isolated night with nothing else in
// it (`taper/stage.ts`); `weaponFire` is turned off after the firing so the
// six ticks that follow count the zone's `ttl` and nothing else, since a ttl
// counts whatever the switches hold (`specs/instrumentation.md`, "The driver
// switches"). The replay covers the firing tick and the six after it.
//
// TOLERANCE. `TIMER_TOL` on the `ttl` the firing tick set; presence on the 5th
// tick and absence on the 6th are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertUndefined } from "../assert";
import { SLASH_FLASH, TICK_HZ, TIMER_TOL } from "../constants";
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
import { slashesOf } from "./stage";

/** The level fired; the flash is the same at every level. */
const LEVEL = 1;

/** The ticks after the firing on which the zone is due: `round(0.1 × 60)`. */
const FLASH_TICKS = Math.round(SLASH_FLASH * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads ttl 0.1 on the firing tick and is gone on the 6th tick after it", async () => {
  await isolate(h);
  await h.debug.setFacing("right");

  const read = await captureReplay(h, "flash", async () => {
    const firing = await fireWeapon(h, "taper", LEVEL);
    await disable(h, "weaponFire");
    const slashes = slashesOf(firing);
    assertEqual(slashes.length, 1, "the slash the level-1 firing tick created");
    const slash = slashes[0]!;
    const ticks = await h.stepWatching(FLASH_TICKS);
    return { slash, ticks };
  });

  assertNear(
    read.slash.ttl ?? NaN,
    SLASH_FLASH,
    TIMER_TOL,
    "the slash's ttl on the tick it fired",
  );
  const before = read.ticks[FLASH_TICKS - 2]!;
  mustZone(before, read.slash.id);
  const due = read.ticks[FLASH_TICKS - 1]!;
  assertUndefined(
    zoneById(due, read.slash.id),
    `the slash in zones on the ${FLASH_TICKS}th tick after the firing`,
  );
});
