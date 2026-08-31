// audio/cue-select — the `select` cue sounds on the frame a cell is selected.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table binds one cue to one event,
// and its first row is "`select` | `CUES.select` | A cell is selected." The
// sentence under the table fixes the timing: "Each is played on the frame its
// event happens ... and at most once on that frame." So the item has two halves
// — a sound on the selecting frame, and no sound on the frames before it — and a
// build that plays its whole palette every frame satisfies neither.
//
// WHY THE KEYBOARD IS THE ROUTE. specs/ui.md also says "A cue is played by a
// frame, never by a pose of the debug surface", so a selection posed through
// `setSelection` is entitled to raise nothing at all, and a check that posed one
// would be reading that entitlement rather than the build's audio.
// specs/controls.md sends `confirm` through the pointer's own table — "`confirm`
// acts on the cursor's cell exactly as a press on that cell does" — whose first
// row is "Any cell, while nothing is selected | Selects that cell", and it binds
// `confirm` to `Enter` and `Space` for a build of every engine. So the cursor's
// cell plus one `confirm` is a selection that really happens inside a frame,
// under all three engines.
//
// WHAT IS READ HERE, AND WHY IT IS THE FAIR READING. This build stands on no
// engine, so the whole audio layer is its own and specs/ui.md fixes the cue
// NAMES inside the build's code rather than on any bus. Nothing outside the
// build can ask which cue sounded, so the harness reports one-shots WITHOUT a
// name and this check reads what is observable: a sound went out, and on which
// frame. The selecting frame is the cleanest of the eight for that reading —
// nothing is exchanged and no chain opens, so `select` is the only cue
// specs/ui.md entitles it to. The music beds are LOOPS and the harness keeps
// them out of `watchCues`, so the bed under the screen cannot answer for the cue.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { maximalRuns, quietRowsWithEscape, type CellRef } from "../board";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";

/** The cell the cursor sits on, and the one `confirm` therefore selects. */
const CELL: CellRef = { col: 4, row: 2 };

/**
 * Frames driven between the arrangement and the press, over a settled board on
 * which nothing at all is happening.
 *
 * No specification figure fixes a count: any stretch of quiet frames reads the
 * same, and four is enough to tell a cue apart from a sound played every frame.
 */
const QUIET_FRAMES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays a cue on the frame confirm selects the cursor's cell", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out, and a build that never makes a
  // sound at all fails here rather than in the middle of the scenario.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // A board with no run on it, so nothing resolves while the check waits and the
  // only event in the window is the selection itself.
  const rows = quietRowsWithEscape([]);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  const posed = await loadBoard(h, rows);
  assertEqual(posed.screen, "playing", "the screen the scenario is posed on");
  await h.debug.setCursor(CELL.col, CELL.row);

  // Watch from here, so every cue the list holds was played by a frame this
  // check drove over the board it posed.
  const cues = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const frame = await captureReplay(h, "select", async () => {
    await h.tapAction("confirm");
    return h.frame();
  });

  // The event the cue is about really happened: specs/controls.md's first row
  // selected the cursor's cell.
  assertDeepEqual(
    (await h.snapshot()).selection,
    { col: CELL.col, row: CELL.row },
    "the selection confirm made",
  );

  // "on no frame before it" — the settled board was silent right up to the press.
  assertLength(
    cues.filter((cue) => cue.frame < frame),
    0,
    "one-shot cues on the frames before the cell was selected",
  );

  // And the selecting frame made a sound.
  assertGreaterThan(
    cuesOnFrame(cues, frame).length,
    0,
    "one-shot cues on the selecting frame",
  );
});
