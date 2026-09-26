// audio/cue-select — the `select` cue sounds on the frame a cell is selected.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table binds one cue to one event,
// and its first row is "`select` | `CUES.select` | A cell is selected." The
// sentence under the table fixes the timing: "Each is played on the frame its
// event happens ... and at most once on that frame." So the item has two halves
// — a sound on the selecting frame, and no sound on the frames before it — and a
// build that plays its whole palette every frame satisfies neither.
//
// WHY A REAL PRESS IS THE ROUTE. specs/ui.md says "A cue is played by a frame,
// never by a pose of the debug surface", so a selection posed through
// `setSelection` is entitled to raise nothing at all, and a check that posed one
// would be reading that entitlement rather than the build's audio. The harness's
// `press` dispatches the pointer event the runtime listens for, so the press
// reaches the game inside a frame's own update exactly as a player's does.
//
// WHY A PRESS IS WHAT SELECTS. specs/controls.md plays the board with the pointer
// alone, and the first row of its press table is "Any cell, while nothing is
// selected | Selects that cell, with no offer standing". `loadBoard` leaves
// nothing selected, so one press on a cell is a selection and nothing else: no
// offer stands, nothing is exchanged, and no chain opens. The selecting frame is
// therefore entitled to `select` and to no other cue in the table.
//
// WHERE THE PRESS IS MADE. At a cell's center, which specs/controls.md's radius
// rule makes the one position that targets exactly one cell — "the cell whose
// center is nearest the pointer position, when that center lies within
// `GEM_HIT_R` (`36`) of it" — and which is well clear of the `pause` target,
// which the same file keeps "wholly outside the board's extent".
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING HERE. This build stands on no
// engine, so the whole audio layer is its own and specs/ui.md fixes the cue NAMES
// inside the build's code rather than on any bus. Nothing outside the build can
// be asked which cue sounded, so the harness reports a one-shot WITHOUT a name
// and this check reads what is observable: a sound went out, and on which frame.
// The selecting frame is the cleanest of the nine for that reading — nothing is
// exchanged and no chain opens, so `select` is the only cue the table entitles it
// to. The quiet frames before the press carry the second half of the item: the
// board is settled and nothing is happening, so a compliant build is silent
// through them. The two music beds of specs/ui.md are LOOPS, and the harness
// keeps them out of `watchCues`, so the bed playing under the screen cannot
// answer for the cue.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  cellCenter,
  maximalRuns,
  quietRowsWithEscape,
  type CellRef,
} from "../board";
import {
  captureReplay,
  createHarness,
  cuesOnFrame,
  loadBoard,
  watchCues,
  type Harness,
} from "../harness";

/** The cell the press lands on, and the one it therefore selects. */
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

it("plays a cue on the frame a press selects a cell", async () => {
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
  assertDeepEqual(posed.selection, null, "the selection a posed board carries");

  // Watch from here, so every cue the list holds was played by a frame this
  // check drove over the board it posed.
  const cues = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const frame = await captureReplay(h, "select", async () => {
    const at = cellCenter(CELL.col, CELL.row);
    await h.press(at.x, at.y);
    await h.advance(1);
    return h.frame();
  });

  // The event the cue is about really happened: specs/controls.md's first press
  // row took hold of the gem at the cell pressed.
  assertDeepEqual(
    (await h.snapshot()).selection,
    { col: CELL.col, row: CELL.row },
    "the selection the press made",
  );

  // "on no frame before it" — read without a name, which the settled board makes
  // enough: nothing at all is happening on it, so no event in the table can fire
  // and a compliant build makes no one-shot sound of any kind there.
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
