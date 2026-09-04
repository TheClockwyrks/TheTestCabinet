// audio/cue-menu-move — a highlight moving plays the menu-move cue, on the
// title, on the level-up overlay, and on an end screen.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`menu-move` |
// `CUES.menuMove` | A menu highlight moves", and under the table: "Each is played
// on the tick its event happens, or on the frame for a menu event".
// specs/ui.md ("Menu navigation") says which menus that covers: "`up` and `down`
// move the highlight ... Every move of a highlight plays `menu-move`, whichever
// of the two moved it, the level-up overlay's offers and the almanac's tab bar
// included." So each of the three menus below plays `menu-move` on the frame its
// highlight moves, and a build that sounds one menu and not another must grade
// differently from one that sounds none. "Whichever of the two moved it" is the
// keyboard here; what a hover that moves a highlight sounds is
// `pointer/title-hover-plays-menu-move`.
//
// WHY THE HIGHLIGHT IS MOVED WITH A REAL KEY. specs/controls.md binds `down` to
// `ArrowDown`, and the surface carries no operation for the keyboard:
// specs/instrumentation.md hands it to the runtime, where "a dispatched keyboard
// event moves the lamplighter and works the menus exactly as a player's key
// does". The tap is down, one frame, up, so exactly one frame carries the press.
//
// WHY EACH MENU IS REACHED THE WAY IT IS.
//   - THE TITLE. `reset` "Restores every declared field of the game's state to
//     its title-screen value: the `title` screen with `menuIndex`, `almanacTab`,
//     and `almanacScroll` all `0`", which is the front door with `TITLE_ITEMS`
//     under it, three items, so one `down` moves the highlight to `1`.
//   - THE LEVEL-UP OVERLAY. An isolated night with every driver switch off,
//     nothing alive, nothing dropped, and no slot held, so the pool is every
//     candidate and the overlay carries `OFFER_COUNT` (`3`) offers; one queued
//     level-up and one tick open it, which is the real route
//     specs/progression.md states.
//   - THE END SCREEN. `setScreen("fallen")` from `playing` "Ends the run exactly
//     as that ending does" (specs/instrumentation.md), and specs/ui.md gives it
//     `END_ITEMS`, two items, with "`menuIndex` is `0` on arriving".
// Each move is asserted off `menuIndex` before its cue is read, so a build whose
// highlight never moved reports that rather than a missing cue.
//
// THE TOLERANCE. None: a cue sounded on the frame or it did not, and each frame
// is exact because a tap carries its press on one frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  openLevelUp,
  pressDown,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, SETTLE_FRAMES } from "./cues";

/** The index a first `down` moves the highlight to, on all three menus. */
const MOVED_INDEX = 1;

/** One level-up queued, enough to open one overlay. */
const QUEUED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays menu-move on the title, the level-up overlay, and an end screen", async () => {
  await h.debug.reset();
  await h.step(SETTLE_FRAMES);

  const cues = await watchNamedCues(h);
  const moved = await captureReplay(h, "move", async () => {
    const title = await pressDown(h);
    const titleFrame = h.frame();

    await isolate(h);
    const overlay = await openLevelUp(h, QUEUED);
    const levelup = await pressDown(h);
    const levelupFrame = h.frame();

    await isolate(h);
    await h.debug.setScreen("fallen");
    const fallen = await pressDown(h);
    const fallenFrame = h.frame();

    return {
      title,
      titleFrame,
      overlay,
      levelup,
      levelupFrame,
      fallen,
      fallenFrame,
    };
  });

  assertEqual(moved.title.screen, "title", "the screen the reset returned to");
  assertEqual(
    moved.title.menuIndex,
    MOVED_INDEX,
    "the title highlight after one down",
  );
  assertHeard(
    cues,
    moved.titleFrame,
    "menu-move",
    "the menu-move cues on the frame the title highlight moved",
  );

  assertEqual(
    moved.overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertGreaterThan(
    moved.overlay.run.offers.length,
    MOVED_INDEX,
    "the offers the overlay presented, for the highlight to move onto",
  );
  assertEqual(
    moved.levelup.menuIndex,
    MOVED_INDEX,
    "the overlay highlight after one down",
  );
  assertHeard(
    cues,
    moved.levelupFrame,
    "menu-move",
    "the menu-move cues on the frame the overlay highlight moved",
  );

  assertEqual(moved.fallen.screen, "fallen", "the screen the ending posed");
  assertEqual(
    moved.fallen.menuIndex,
    MOVED_INDEX,
    "the end-screen highlight after one down",
  );
  assertHeard(
    cues,
    moved.fallenFrame,
    "menu-move",
    "the menu-move cues on the frame the end-screen highlight moved",
  );
});
