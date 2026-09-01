// ship/lockout-blocks-fire — while the fire lockout stands, the fire action adds
// nothing.
//
// specs/ship.md, "What blocks a shot": firing is allowed only when "The fire lockout
// is at zero. A flip sets it to `FLIP_LOCKOUT` (`0.30`) seconds, and it counts down
// with game time", and "Otherwise the fire action adds nothing". specs/bands.md
// states the same cost from the flip's side. This point decides the BLOCK;
// `ship/lockout-expires` decides that the block lifts, so a build that ignores the
// lockout and a build that never lets it go are told apart and graded apart.
//
// THE LOCKOUT IS POSED, NOT FLIPPED FOR. The review item says so — "With the fire
// lockout posed at `FLIP_LOCKOUT`" — and it is the right way round: `setFireLockout`
// "Sets the seconds of post-flip fire lockout remaining"
// (specs/instrumentation.md), so what is under test is the CANNON's response to a
// standing lockout and not the flip that would ordinarily start one, which is
// `bands/flip-starts-lockout`'s point. A build whose flip forgets the lockout loses
// that point, once.
//
// THE KEY IS HELD FOR HALF THE LOCKOUT. Fifteen frames of the harness's 100 Hz
// clock, against the thirty `FLIP_LOCKOUT` is worth: comfortably inside the standing
// lockout for any build that counts it down with game time as the specification
// says, so a conforming build is still blocked on the last frame of the hold. It is
// also comfortably longer than `FIRE_INTERVAL` is short — a build that ignores the
// lockout fires on the first frame it reads the key down, since `startPosed` leaves
// the cooldown at zero and the field empty — so the window is far more than a build
// that ignores the rule needs to give itself away.
//
// THE COUNT IS AN EQUALITY AT ZERO, and it can be, because the field starts empty:
// the check asserts that before the key goes down, so a single friendly bullet
// anywhere in the roster afterwards is a shot the lockout should have stopped.
//
// THE KEY IS HELD RATHER THAN TAPPED, because `specs/controls.md` reads `a` as a
// HOLD: a key pressed and released inside one frame leaves the action at rest for
// the whole of that frame's update, and a build that never read the action at all
// would pass a check that never asked it to.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so nothing else can
// put a bullet on the field while the key is down.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL, FLIP_LOCKOUT } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  playerBullets,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { FIRE_KEY } from "./cannon";

/** What the field holds before and after the hold: nothing. */
const BULLETS = 0;

/**
 * The frames the fire action is held: half of `FLIP_LOCKOUT`.
 *
 * Half, so a build counting the lockout down with game time as `specs/ship.md`
 * states still has a standing lockout on the last frame of the hold and the reading
 * is unambiguous. Fifteen frames is also longer than the sixteen-frame
 * `FIRE_INTERVAL` is short: a build that ignores the lockout has the cooldown at
 * zero and an empty field in front of it, so it fires on the first frame.
 */
const HELD_FRAMES = ticksFor(FLIP_LOCKOUT / 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds no bullet while the fire lockout stands", async () => {
  startPosed(h);
  h.debug.setFireLockout(FLIP_LOCKOUT);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the fire action");
  assertEqual(
    before.phase,
    "live",
    "the ship is flying rather than respawning",
  );
  assertEqual(
    before.ship.lockout,
    FLIP_LOCKOUT,
    `the seconds of fire lockout the ship was posed with, FLIP_LOCKOUT ` +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    before.ship.cooldown,
    0,
    "the fire cooldown, left clear so the lockout is the only thing that can " +
      "block a shot",
  );
  assertLength(
    playerBullets(before),
    BULLETS,
    "the player's bullets on the field before the key went down",
  );

  await holdFor(h, FIRE_KEY, HELD_FRAMES);
  // Before the assertion, so a check that fails still leaves the picture of the
  // field the locked-out key produced.
  captureStill(h, "blocked");

  assertLength(
    playerBullets(h.snapshot()),
    BULLETS,
    `the player's bullets on the field after the fire action was held for ` +
      `${String(HELD_FRAMES)} frames — half of FLIP_LOCKOUT ` +
      `(${String(FLIP_LOCKOUT)}s), and ${String(ticksFor(FIRE_INTERVAL))} ` +
      "frames is all a build that ignored the lockout would have needed " +
      "(specs/ship.md)",
  );
});
