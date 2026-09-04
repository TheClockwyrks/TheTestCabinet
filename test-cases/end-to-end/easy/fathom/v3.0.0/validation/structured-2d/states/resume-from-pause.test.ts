// states/resume-from-pause — RESUME returns to live play where the dive froze.
//
// specs/ui.md's transition table: `"paused"` + `RESUME` confirmed -> `"playing"`.
// It is the way out of the pause menu a player takes when they meant to carry on,
// and the point has a second half the transition table implies rather than
// states: the dive it returns to is the dive that was paused. A build that
// resumed by opening a fresh attempt would satisfy the screen change and lose the
// player their run.
//
// SO THE ARRANGEMENT IS READ ACROSS THE RESUME. The board is posed first — one
// hunter across solid rock, the forager somewhere it did not begin, a score and a
// depth well off their opening values — and every one of those is read back after
// the confirm. The hunter is HELD rather than left to travel: what its own mind
// decides is irrelevant here and a body free to move would put a moving target
// into the comparison.
//
// THE SELECTION IS POSED, NEVER WALKED. `setMenuIndex` puts the highlight on
// `RESUME` (specs/instrumentation.md) and one `confirm` takes it, so a build with
// a broken `down` action fails `controls` and passes this. The pause menu itself
// is reached through `setScreen`, because opening it is `controls.pause-esc`'s
// point. Escape and `KeyP` resuming are `navigation.pause-back` and
// `navigation.pause-p-resumes`.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import { holdPredators, poseApart, spawnPredator } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

/** The pause menu's entries, by index (specs/ui.md, `PAUSE_ITEMS`). */
const RESUME = PAUSE_ITEMS.indexOf("RESUME");

/** How far the hunter's own ring stands from the forager's room, in tiles. */
const APART_TILES = 10;

/** How many tiles of corridor that ring holds. */
const RING_TILES = 4;

/** The score the dive is posed onto, so the reading is of a figure carried over. */
const POSED_SCORE = 860;

/** The depth it is posed onto, for the same reason. */
const POSED_DEPTH = 3;

/** Where each body stood, as one comparable string. */
function places(bodies: readonly { x: number; y: number }[]): string {
  return bodies.map((one) => `${String(one.x)},${String(one.y)}`).join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to live play on the dive it froze", async () => {
  startPlaying(h);
  const rooms = await poseApart(h, APART_TILES, { ring: RING_TILES });
  await spawnPredator(h, "lanternjaw", rooms.far, { state: "wander" });
  await holdPredators(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setDepth(POSED_DEPTH);

  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESUME);
  const frozen = h.snapshot();
  assertEqual(frozen.screen, "paused", "the screen the confirm is made on");
  assertEqual(frozen.menuIndex, RESUME, "the posed pause-menu selection");

  await h.tap(CONFIRM_KEY);
  const resumed = h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "resumed");

  assertEqual(
    resumed.screen,
    "playing",
    "the screen RESUME confirmed on the pause menu returns to (specs/ui.md)",
  );
  assertEqual(
    places([resumed.forager]),
    places([frozen.forager]),
    "where the forager stands on the dive RESUME returned to, which is the " +
      "dive that was frozen (specs/ui.md)",
  );
  assertEqual(
    places(resumed.predators),
    places(frozen.predators),
    "where the hunters stand on the dive RESUME returned to (specs/ui.md)",
  );
  assertEqual(
    resumed.score,
    frozen.score,
    "the score on the dive RESUME returned to (specs/ui.md)",
  );
  assertEqual(
    resumed.lives,
    frozen.lives,
    "the lives on the dive RESUME returned to (specs/ui.md)",
  );
  assertEqual(
    resumed.depth,
    frozen.depth,
    "the depth on the dive RESUME returned to (specs/ui.md)",
  );
  assertEqual(
    resumed.planktonRemaining,
    frozen.planktonRemaining,
    "the plankton left on the dive RESUME returned to (specs/ui.md)",
  );
});
