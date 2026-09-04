// injector/fire-pointer — a primary pointer press releases the loaded core.
//
// THE SPEC IT RESTS ON. `specs/controls.md` ("Actions") makes the shot answer
// the pointer as well as the key: `fire`, since "A pointer press on `playing`
// raises `fire`", so "a shot leaves the injector where the pointer put the
// aim". `specs/controls.md` ("What each screen reads") makes it live on
// `playing` alone. `specs/injector.md` fixes what a shot does to the two
// slots: "Firing moves the queued charge into the loaded slot and draws a new
// queued charge".
//
// WHY IT IS ITS OWN POINT. Every other firing point in this case drives
// `Space` or the surface's own `fire()`, so a build wired to the keyboard
// alone passes all of them. A player holding a mouse has no shot at all in
// that build, and the pointer is also the only way that player aims.
//
// WHERE THE PRESS LANDS. 200 units straight above the injector's center. The
// harness moves the pointer to the point before it presses, which is what
// `specs/controls.md` has set the aim, and straight up the field is clear of
// the one parked core.
//
// THE HALL. One core parked far up the channel and the quota exhausted,
// exactly as `injector/projectile-speed` poses it: the core keeps
// `specs/progression.md`'s clear condition — "the moment its quota is
// exhausted and no cores remain on the channel" — from firing, and stands
// nowhere the shot can reach. `poseHall` holds the inlet, so nothing joins
// them.
//
// THE TOLERANCE. None. A count of projectiles and a charge id are both exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { INJECTOR } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  projectileCount,
  type Harness,
} from "../harness";

/** The charges the injector is posed holding, distinct so the draw is readable. */
const LOADED = "halide";
const QUEUED = "cobalt";

/** A core parked far up the channel: nothing the shot can reach, and enough to
 * keep the level from clearing under an exhausted quota. */
const PARKED_S = 1300;

/**
 * Where the press lands: 200 units straight above the injector's center.
 *
 * Straight up the field is clear of the parked core, and it is not the
 * injector's own center, which `specs/controls.md` says "leaves the aim
 * unchanged".
 */
const PRESS = { x: INJECTOR.x, y: INJECTOR.y - 200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("releases the loaded core when the pointer is pressed in play", async () => {
  await poseHall(h, {
    level: 1,
    quotaRemaining: 0,
    cores: [[PARKED_S, "olivine", null]],
    loaded: LOADED,
    queued: QUEUED,
  });
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the press is made from");
  assertEqual(posed.injector.loaded, LOADED, "the charge posed as loaded");
  assertEqual(projectileCount(posed), 0, "the projectiles before the press");

  const fired = await h.clickPointer(PRESS.x, PRESS.y);
  captureStill(h, "fired");

  assertGreaterThan(
    projectileCount(fired),
    0,
    "the projectiles the pointer press put in the hall",
  );
  assertEqual(
    fired.injector.loaded,
    QUEUED,
    "the charge the shot moved into the loaded slot",
  );
});
