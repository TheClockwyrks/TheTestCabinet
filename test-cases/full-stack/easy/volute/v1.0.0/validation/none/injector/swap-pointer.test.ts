// injector/swap-pointer — a secondary pointer press exchanges the loaded and
// queued cores.
//
// THE SPEC IT RESTS ON. `specs/controls.md` ("Actions and bindings"): "swap |
// `KeyX` | secondary button | edge | exchanges the loaded and queued cores",
// with "The field answers a secondary press as a control" beneath the table.
// `specs/injector.md` fixes what the exchange does: "a swap exchanges the two
// charges, draws nothing, and is available whether or not the fire cooldown
// has expired."
//
// WHY IT IS ITS OWN POINT, AND WHY IT RUNS UNDER `none` ALONE. `injector/swap`
// drives `KeyX`, so a build that never wired the pointer's second button
// passes it. The binding itself exists only in this configuration: under
// either engine the pointer belongs to the engine, whose control scheme
// carries no secondary button, and the rendered `specs/controls.md` there
// binds swap to the keyboard action alone. So the manifest scopes the point to
// `none`, where the build writes the input layer that "tells the primary and
// secondary pointer buttons apart".
//
// THE TWO CHARGES. `halide` and `cobalt`, the pair `injector/swap` names, both
// in level 1's charge set. They are distinct, which is the whole of what the
// reading needs.
//
// WHAT ELSE IS READ, AND WHY. That the hall holds no projectile afterwards.
// `specs/controls.md` gives the PRIMARY button the shot and the secondary the
// swap, so a build that treats every press as a press has to fail here rather
// than pass on an exchange it also fired through.
//
// THE TOLERANCE. None. A charge id is one of five names and a count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { INJECTOR } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  projectileCount,
  type Harness,
} from "../harness";

/** The charge the injector is posed holding loaded. */
const LOADED = "halide";

/** The charge it is posed holding queued, distinct from the loaded one. */
const QUEUED = "cobalt";

/** Where the press lands: clear of the injector's own center. */
const PRESS = { x: INJECTOR.x, y: INJECTOR.y - 200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("exchanges the loaded and queued charges on a secondary pointer press", async () => {
  await poseHall(h, { loaded: LOADED, queued: QUEUED });

  const posed = await h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the press is made from");
  assertEqual(posed.injector.loaded, LOADED, "the charge posed as loaded");
  assertEqual(posed.injector.queued, QUEUED, "the charge posed as queued");

  const swapped = await h.clickPointer(PRESS.x, PRESS.y, "right");
  await captureStill(h, "swapped");

  assertEqual(
    swapped.injector.loaded,
    QUEUED,
    "the loaded charge after a secondary press",
  );
  assertEqual(
    swapped.injector.queued,
    LOADED,
    "the queued charge after a secondary press",
  );
  assertEqual(
    projectileCount(swapped),
    0,
    "the projectiles a secondary press put in the hall, which fires nothing",
  );
});
