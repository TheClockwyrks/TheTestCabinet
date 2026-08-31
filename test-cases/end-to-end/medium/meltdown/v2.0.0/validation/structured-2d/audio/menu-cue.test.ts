// Meltdown — audio/menu-cue: moving the highlight on a menu plays the `menu` cue
// on the frame it moves.
//
// `specs/audio.md` binds `menu` to "a menu highlight moves" and fixes the frame:
// a cue "is raised by the frame that resolves the event it answers".
// `specs/screens.md` fixes the event — "`up` and `down` move the highlight one
// row" — and `specs/controls.md` binds `down` to `ArrowDown` and reads every
// action "as a press edge", firing once per press.
//
// THE MOVE IS THE PLAYER'S. `setMenuIndex` sets the field alone and no operation
// of the debug surface plays a cue (`specs/instrumentation.md`), so the highlight
// is moved by a real key pressed and released at the engine's own event target,
// which is the only route with a frame for a cue to belong to.
//
// THE TITLE SCREEN IS WHERE THIS IS READ, because it is the screen a freshly
// reset game is already on and its menu is two rows, `PLAY` and `HOW TO PLAY`
// (`specs/screens.md`), so `down` from row `0` lands on row `1` without wrapping
// and without taking anything. Nothing else on that screen can sound: the
// simulation does not run off the `playing` screen, so no shot, kill, leak, trip
// or clear is reachable. That is what makes "the menu cue and nothing else" a
// reading of the build rather than of the scenario.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../../src/constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  watchCues,
  type Harness,
} from "../harness";
import { playedBefore, playedOn } from "./cues";

/**
 * Frames the title screen is held before the key, so "on no frame before it" is
 * read across a stretch of the same screen the move is then made on rather than
 * across nothing at all. Half a second at the suite's 120 Hz clock.
 */
const QUIET_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the menu cue on the frame the highlight moves", async () => {
  // `reset` restores the title screen with `menuIndex` at `0`
  // (specs/instrumentation.md).
  resetTo(h);

  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "posing: the game is on the title screen (specs/instrumentation.md)",
  );
  assertEqual(
    opened.menuIndex,
    0,
    "posing: the highlight opens on the first row (specs/instrumentation.md)",
  );

  const played = watchCues(h);
  await h.advance(QUIET_TICKS);

  await tapAction(h, "down");
  const frame = h.engine.frame().count;
  captureStill(h, "menu");

  assertEqual(
    h.snapshot().menuIndex,
    1,
    "the highlighted row after one `down`: the highlight moved one row " +
      "(specs/screens.md, Menus)",
  );
  assertLength(
    playedBefore(played, frame),
    0,
    `cues that played over the ${String(QUIET_TICKS)} frames before the key — ` +
      "a cue is raised by the frame that resolves the event it answers " +
      "(specs/audio.md)",
  );
  assertDeepEqual(
    playedOn(played, frame),
    [CUES.menu],
    "the cues that played on the frame the highlight moved: the menu cue, and " +
      "nothing else (specs/audio.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the gain the menu cue played at on an unmuted bus (specs/audio.md)",
  );
});
