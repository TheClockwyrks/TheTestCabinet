// Wick — taper/hits-firing-tick-only: the slash has a hitbox on the tick it
// fires and on no other.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "on the tick it fires it hits every enemy
//     overlapping it, and it has no hitbox on any other tick."
//   - `specs/state.md` (`ZoneState`, `ttl`): a slash is "drawn for that long
//     and dealing its damage on the tick it appears alone."
//   - `specs/instrumentation.md` (`setEnemyPosition`): "Moves enemy `id` to
//     `(x, y)`; its heading, age, and health are untouched."
//   - `specs/weapons.md` ("Cooldown timers"): after the firing the timer is
//     set to `1.35`, so Taper fires again no sooner than 81 ticks later and
//     the tick after the firing has no new slash.
//
// WHAT IS READ. A moth standing at `(player.x + 200, player.y)`, 80 past the
// level-1 far edge, on the firing tick, so the slash misses it. It is then
// moved to `(player.x + 60, player.y)`, the middle of the rectangle, and one
// more tick runs. The moth is still standing with its hp exactly as it was:
// the slash that fired a tick ago dealt nothing to it.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper alone at level 1, facing right, every
// switch but `weaponFire` off, so the slash is the only thing that can change
// the moth and the moth holds wherever it is posed. The firing is read on its
// tick, a slash in `zones`, so the second tick is known to follow a real
// firing and not a tick nothing fired on.
//
// TOLERANCE. None: the hp is untouched, so it is read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  spawnEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";
import { PROBE, armTaper, assertUnhurt } from "./slash";

/** Where the moth stands on the firing tick: 80 past the far edge at 120. */
const CLEAR_DX = 200;

/** Where the moth is moved for the tick after: the middle of the rectangle. */
const INSIDE_DX = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("deals nothing to a moth moved into the rectangle on the tick after the firing", async () => {
  armTaper(h, 1, "right");
  const moth = spawnEnemyNear(h, PROBE, CLEAR_DX, 0);
  const posed = h.snapshot();

  const fired = await h.tick(1);
  assertEqual(
    zonesOfKind(fired, "slash").length,
    1,
    "slashes on the firing tick",
  );
  assertUnhurt(posed, fired, moth, "the moth clear of the slash on its tick");

  const { player } = fired.run;
  h.debug.setEnemyPosition(moth, player.x + INSIDE_DX, player.y);
  const moved = h.snapshot();
  const after = await h.tick(1);
  captureStill(h, "once");

  assertUnhurt(moved, after, moth, "the moth inside the rectangle a tick late");
});
