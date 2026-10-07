// Wick — taper/hits-firing-tick-only: the slash hits on the tick it fires and
// on no other.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"): "on the tick
// it fires it hits every enemy overlapping it, and it has no hitbox on any
// other tick." The slash stays in `zones` for `SLASH_FLASH` (`0.1`) seconds
// after that, so on the tick after the firing a zone is there to be tested
// against, and the specification says its rectangle hits nothing.
//
// THE POSE. Taper at level 1 fires on an isolated night with a moth posed well
// clear of the rectangle, at `(60, 300)`: the level-1 slash spans `y` from
// `-20` to `20`, so the moth's nearest point is `280` away. After the firing
// tick the moth is moved onto the slash's own center, `(60, 0)`, by
// `setEnemyPosition` (`specs/instrumentation.md`: "Moves enemy `id` to
// `(x, y)`; its heading, age, and health are untouched"), and one more tick
// runs. `weaponFire` is turned off first, so nothing new fires on that tick
// and the only shape the moth could meet is the slash of the tick before; the
// zone's ttl counts and its hits resolve whatever the switches hold
// (`specs/instrumentation.md`, "The driver switches").
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
import { assertUntouched } from "./stage";

/** The level whose slash is read: `120 × 40`, centered at `(60, 0)`. */
const LEVEL = 1;

/** Where the moth waits out the firing tick: far below the slash. */
const CLEAR = { x: 60, y: 300 };

/** Where it is moved for the tick after: the slash's own center. */
const ONTO_SLASH = { x: 60, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a moth moved into the slash on the tick after the firing untouched", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("right");
  const at = opened.run.player;
  const moth = await placeEnemy(h, "moth", at.x + CLEAR.x, at.y + CLEAR.y);

  const firing = await fireWeapon(h, "taper", LEVEL);
  assertUntouched(firing.after, moth, "the moth clear of the firing tick");

  await disable(h, "weaponFire");
  await h.debug.setEnemyPosition(
    moth.id,
    at.x + ONTO_SLASH.x,
    at.y + ONTO_SLASH.y,
  );
  const next = await h.step(1);
  await captureStill(h, "once");

  assertUntouched(
    next,
    moth,
    "the moth on the slash the tick after the firing",
  );
});
