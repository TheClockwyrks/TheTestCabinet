// pointer/title-hover-plays-menu-move — the frame a hover moves the highlight on
// sounds the menu-move cue once.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 1:
// "The pointer inside the rectangle of the item at `menuIndex` `i`, with
// `menuIndex` not `i`, sets `menuIndex` to `i` and plays `menu-move`."
// specs/ui.md ("Menu navigation"): "Every move of a highlight plays `menu-move`,
// whichever of the two moved it". specs/ui.md ("Audio"): each cue is played "on
// the tick its event happens, or on the frame for a menu event", and at most
// once on it.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The named-cue log, filtered to the
// one frame the hover was read on. The probe names a cue by the file it was
// decoded from, so what is counted is the build's own `menu-move`, and the count
// is exactly one because a menu event sounds its cue once on its frame. The
// highlight is read first, so a build whose pointer moved nothing fails on the
// move rather than on the silence.
//
// HOW THE SCENARIO IS DRIVEN. The harness is CREATED armed: a key bound to
// nothing is pressed before the harness's opening `reset`, so the browser opens
// the build's audio context on a genuine gesture and the restore puts back
// whatever that gesture touched, and the build's produced cue files are given
// time to decode before the harness is handed over. Two settling frames then
// run before the watcher attaches, so nothing a loop started on lands on the
// frame the check reads. The pointer is moved to the middle of the SECOND title
// rectangle from the `menuIndex` `0` the title opens on, so the frame carries a
// move; the mouse is Chromium's own and exactly one frame runs after it.
//
// THE TOLERANCE. None: a cue sounded on the frame or it did not, and the frame
// is exact because exactly one frame follows the move.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  hoverAt,
  watchNamedCues,
  type Harness,
} from "../harness";
import {
  assertHeardOnce,
  assertHighlight,
  menuPoints,
  poseTitle,
  SETTLE_FRAMES,
} from "./stage";

/** The item the pointer enters: `THE ALMANAC`, the second of `TITLE_ITEMS`. */
const HOVERED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds menu-move once on the frame the pointer entered the second item", async () => {
  await poseTitle(h);
  await h.step(SETTLE_FRAMES);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  const cues = await watchNamedCues(h);
  const moved = await captureReplay(h, "move", async () => {
    const hovered = await hoverAt(h, points[HOVERED]!);
    return { hovered, frame: h.frame() };
  });

  assertHighlight(
    moved.hovered,
    "title",
    HOVERED,
    "under a pointer inside the second title item's rectangle",
  );
  assertHeardOnce(
    cues,
    moved.frame,
    "menu-move",
    "the menu-move cues on the frame the hover moved the title highlight",
  );
});
