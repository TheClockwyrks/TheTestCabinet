// Wick — flare/no-lingering-damage: a burst damages nothing after the tick it
// fires.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Flare"): "On firing,
// every enemy within `radius` of the player's center takes `damage` on that
// tick", and "The burst is drawn for `FLARE_FLASH` (`0.4`) seconds and has no
// hitbox after the tick it fires." `specs/world.md` ("Timers") makes a `ttl`
// of `0.4` due `round(0.4 × 60)` = `24` ticks after the tick it was set on, so
// on the tick after the firing the zone is still in `zones` to be tested
// against, and the specification says its circle hits nothing. A moth carries
// `5` hp (`specs/enemies.md`, unscaled at a run clock of `0`), which any row's
// damage would take, so a moth standing in the burst on that tick is either
// untouched at `5` or gone.
//
// THE POSE. An isolated night with nothing alive, Flare held at level 1 and
// fired through the shared `fireWeapon`, so the burst is created against an
// empty field and reaches nothing on its own tick. `weaponFire` is then turned
// off, so no second firing lands on the tick that follows, and one moth is
// spawned `100` along `+x` from the lamplighter, inside the `640`. One more
// tick runs: a zone's `ttl` counts and its hits resolve whatever the switches
// hold (`specs/instrumentation.md`, "The driver switches"), so the only shape
// the moth could meet on it is the burst of the tick before, and a spawned
// enemy "first ... hits ... on the next tick", which this is.
//
// TOLERANCE. None: the moth is present at its posed hp, or it is not.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  disable,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { FLARE, TARGET_OFFSET, assertUntouched, oneBurst } from "./stage";

/** The level whose burst is read; the hitbox rule is the same at every level. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a moth spawned inside the burst on the tick after the firing untouched", async () => {
  await isolate(h);

  const firing = await fireWeapon(h, FLARE, LEVEL);
  oneBurst(firing.zones, "the firing tick on an empty field");

  await disable(h, "weaponFire");
  const moth = await placeEnemy(h, "moth", TARGET_OFFSET, 0);
  const next = await h.step(1);
  await captureStill(h, "once");

  assertUntouched(next, moth, "the moth in the burst the tick after it fired");
});
