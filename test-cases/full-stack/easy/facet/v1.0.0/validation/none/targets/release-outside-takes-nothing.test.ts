// Facet — targets/release-outside-takes-nothing: a release anywhere but inside
// the armed target takes nothing.
//
// The fourth row of specs/controls.md's table of what the pointer does to a
// screen: "Releases anywhere else — Nothing is taken, and the armed target is
// disarmed."
//
// IT IS THE ROW THAT LETS A PLAYER CHANGE THEIR MIND. A press arms; a release
// somewhere else abandons what it armed. Without it a control is taken the
// instant it is touched, which is exactly the fault
// `targets/press-arms-target` reads from the other side — and on a touchscreen,
// where a fingertip covers a whole menu row and a thumb slides while it presses,
// it is the difference between a menu that can be used and one that cannot.
//
// TWO RELEASES, ONE POINT, BECAUSE THE ROW IS ONE ROW. "Anywhere else" is one
// sentence covering both places a release can land: clear of every target, and
// inside a DIFFERENT target. The second is included because a build that took
// whichever target the release happened to land in would pass the first — it
// would take nothing out on the empty stage — and would take the wrong item the
// moment a player's finger slid from one row onto the next. Neither is a separate
// rule, so neither is a separate point.
//
// TWO READINGS EACH. The screen is still `title`, so nothing was taken; and
// `armedTarget` is `null`, so the arming was dropped rather than left standing
// for the next release to act on. A build that left it armed would take the item
// on some later release the player never aimed at it.
//
// WHERE THE FIRST RELEASE LANDS is computed from the reported rectangles rather
// than written down — a lattice of stage positions is walked and the first that
// lies in none of them is taken — because a point written down could fall inside
// a menu a build laid out differently, and the check would then be reading the
// third row instead of the fourth.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import type { TargetRect } from "../board";
import {
  captureReplay,
  createHarness,
  movePointer,
  moveOverTarget,
  pressTarget,
  releasePointer,
  targetById,
  type Harness,
} from "../harness";

/** The target the press arms, both times. */
const ARMED = "menu-0";

/** The other target on the title screen, which the second release lands inside. */
const OTHER = "menu-1";

/** How far apart the lattice of candidate positions is walked, in stage units. */
const LATTICE_STEP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Whether a stage point lies inside a target's rectangle, its edges counted in. */
function insideTarget(
  point: { x: number; y: number },
  target: TargetRect,
): boolean {
  return (
    point.x >= target.x &&
    point.x <= target.x + target.w &&
    point.y >= target.y &&
    point.y <= target.y + target.h
  );
}

/**
 * A stage position lying in none of `targets`, found by walking a lattice.
 *
 * `null` when the screen's targets cover every position tried, which no screen
 * meeting the requirements in `targets/targets-min-size` and
 * `targets/targets-on-stage` can do — so the caller reports it as a reading it
 * could not take rather than passing quietly.
 */
function pointClearOfAll(
  targets: readonly TargetRect[],
): { x: number; y: number } | null {
  for (let y = LATTICE_STEP; y < STAGE_H; y += LATTICE_STEP) {
    for (let x = LATTICE_STEP; x < STAGE_W; x += LATTICE_STEP) {
      const point = { x, y };
      if (!targets.some((target) => insideTarget(point, target))) return point;
    }
  }
  return null;
}

it("takes nothing when the release lands off the armed target", async () => {
  await h.debug.reset();
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the screen the gestures are made on");

  const first = targetById(opened, ARMED);
  const second = targetById(opened, OTHER);
  const away = pointClearOfAll(opened.targets);
  if (away === null) {
    fail(
      "a stage position clear of every target the title screen reports",
      opened.targets.map((target) => target.id),
    );
  }

  await captureReplay(h, "slipped", async () => {
    // One: pressed on a control, slid clear of every control, let go there. No
    // frame runs inside the gesture: specs/instrumentation.md resolves each of
    // the three at the call, so the whole slip is posed with the game standing
    // still, and the frame after it is what the recording shows.
    const armed = await pressTarget(h, first);
    assertEqual(armed.armedTarget, ARMED, "the target the first press armed");

    await movePointer(h, away.x, away.y);
    const slipped = await releasePointer(h);
    await h.advance(1);

    assertEqual(
      slipped.screen,
      "title",
      "the screen after a release clear of every target",
    );
    assertEqual(
      slipped.armedTarget,
      null,
      "the armed target after a release clear of every target",
    );

    // Two: pressed on the same control, slid onto the OTHER one, let go there.
    // A build that takes whichever target the release lands in leaves the title
    // screen here, having taken an item the player never pressed.
    const rearmed = await pressTarget(h, first);
    assertEqual(
      rearmed.armedTarget,
      ARMED,
      "the target the second press armed",
    );

    await moveOverTarget(h, second);
    const wrong = await releasePointer(h);
    await h.advance(1);

    assertEqual(
      wrong.screen,
      "title",
      `the screen after a release inside ${OTHER}, which the press did not arm`,
    );
    assertEqual(
      wrong.armedTarget,
      null,
      `the armed target after a release inside ${OTHER}`,
    );
  });
});
