// Wireworm — audio/menu: moving a menu highlight plays the `menu` cue, once per
// move.
//
// specs/ui.md's cue table: "`menu` | `CUES.menu` | A menu highlight moves.",
// played "on the frame its event happens and at most once on that frame".
// specs/controls.md fixes the move: "`up` and `down` move the highlight by one
// item and wrap at both ends". So the reading is one cue per move, each on the
// frame its own move landed.
//
// The move is driven through the REAL registered action, the way a player moves
// it — `down` on its first bound key (specs/controls.md) — rather than by posing
// `menuIndex`, because the cue belongs to the move and a posed field is not a
// move.
//
// TWO moves are driven, not one, because "once per move" is a rate and a single
// move cannot tell a rate apart from a latch. A build that plays the cue on the
// first move and then falls silent, one that plays it on every frame the key is
// down, and one that plays it once for the pair each read differently from a
// build that sounds one cue per move.
//
// The title screen is where the moves are driven, since it is where a fresh
// `reset` leaves the game (specs/instrumentation.md) and its menu is the one
// specs/ui.md gives `TITLE_ITEMS` for. Nothing else is on the board: no run has
// been opened, so the only thing that can sound is the menu.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Where the highlight rests on arriving at the title: the first item
 * (specs/ui.md), counted from `0`.
 */
const FIRST_ITEM = 0;

/** Where one `down` from the first item leaves it (specs/controls.md). */
const SECOND_ITEM = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays one menu cue per move of the highlight", async () => {
  resetTo(h);
  // One frame, so the title has been drawn before the highlight is moved on it.
  await h.advance(1);
  assertEqual(h.snapshot().screen, "title", "the game opens on the title");
  assertEqual(
    h.snapshot().menuIndex,
    FIRST_ITEM,
    "the highlight rests on the first item before the moves",
  );

  // Subscribed after the screen is settled, so what is read is the moves alone.
  const played = watchCues(h);

  // `tapAction` presses, releases, and runs the one frame that delivers the
  // edge, so the frame read here is the frame this move landed on.
  await tapAction(h, "down");
  const firstFrame = h.engine.frame().count;
  captureStill(h, "menu");
  assertEqual(
    h.snapshot().menuIndex,
    SECOND_ITEM,
    "the first move takes the highlight down one item",
  );

  await tapAction(h, "down");
  const secondFrame = h.engine.frame().count;
  assertNotEqual(
    h.snapshot().menuIndex,
    SECOND_ITEM,
    "the second move takes the highlight off that item again",
  );

  assertDeepEqual(
    played.map((cue) => cue.cue),
    [CUES.menu, CUES.menu],
    "one menu cue per move, and nothing else on the title",
  );
  assertEqual(
    played[0].frame,
    firstFrame,
    "the first cue plays on the frame the first move landed (specs/ui.md)",
  );
  assertEqual(
    played[1].frame,
    secondFrame,
    "the second cue plays on the frame the second move landed (specs/ui.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
  assertGreaterThan(
    played[1].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
});
