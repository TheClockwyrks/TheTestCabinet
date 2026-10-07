// audio/cue-refuse — the `refuse` cue sounds on the frame a swap is refused.
//
// THE ROW THIS IS ABOUT. specs/ui.md's CUES table: "`refuse` | `CUES.refuse` | A
// swap is refused", under a sentence that fixes the timing — "Each is played on
// the frame its event happens ... and at most once on that frame."
// specs/rules.md says what a refusal is: "A swap that breaks one is refused and
// the board is unchanged", and "A refused swap changes nothing on the board and
// leaves `phase` `idle`. It sets `refusal` to the two cells it named." So the
// refusing frame is the one that leaves a standing refusal and the board where it
// was, and the cue belongs to it.
//
// WHY THE RELEASE IS THE FRAME. specs/controls.md makes the release the edge that
// asks — "Nothing reaches the move rules until the pointer is released" — and
// "Every requested swap goes through one acceptance path". So the frame carrying
// the release is the frame R1, R2 and R3 decide the move on, whether they take it
// or refuse it.
//
// WHY THE GESTURE IS MADE WITH A REAL POINTER. specs/ui.md says "A cue is played
// by a frame, never by a pose of the debug surface", so a swap posed through
// `requestSwap` is entitled to raise nothing, and a check that posed one would be
// reading that entitlement rather than the build's audio. The harness's `press`,
// `moveTo` and `lift` dispatch the pointer events the runtime listens for, and
// each is given a frame of its own so the cue a frame raises belongs to one edge.
//
// WHY THIS REQUEST IS REFUSED. R1 accepts the pair — they are orthogonally
// adjacent — and R3 does not: the run-free filler produces no maximal run under
// this exchange and neither cell holds a `prism`. The fixture asserts both halves
// off the WRITTEN board, so a build that refuses for the wrong reason still
// refuses for a reason the specification gives.
//
// THE REFUSING FRAME IS THE CLEANEST OF THE NINE. Nothing is exchanged, no swap
// goes into motion and no chain opens, so `refuse` is the only cue specs/ui.md
// entitles that frame to.
//
// WHAT IS READ, AND WHERE THE SILENT WINDOW HAS TO OPEN. This build stands on no
// engine, so specs/ui.md fixes the cue NAMES inside the build's own code and
// nothing outside it can be asked which cue sounded. The harness reports a
// one-shot WITHOUT a name, so what is read is a sound and the frame that made it,
// and the frames before it are read for silence rather than for the absence of
// one name. The PRESS is the one frame in the gesture that is entitled to a sound
// of its own — specs/controls.md has it take hold of the gem, which is the
// `select` cue's event — so the window that must be silent is the frames from the
// posed board up to the press, and then the frames from the press to the release.
// The carry between them offers the gem into its neighbor, and specs/ui.md's
// table gives an offer no cue at all.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
  cellCenter,
  isPrism,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
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

/** The cell the press takes hold of, in the middle of the run-free filler. */
const HELD: CellRef = { col: 3, row: 3 };

/** The neighbor the carry offers it into, so R1 accepts and only R3 can refuse. */
const OFFERED: CellRef = { col: 4, row: 3 };

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

it("plays a cue on the frame the release is refused", async () => {
  // specs/assets.md decodes the produced `.wav`s asynchronously and specs/ui.md
  // opens audio only after an interaction, so a build's first frames are
  // legitimately silent. Warming waits that out.
  assertTrue(await h.warmAudio(), "the build made a sound once audio opened");

  // The fixture's own guarantees, read off the written board: the pair is one R1
  // accepts, neither cell is a prism, and R3 refuses the exchange all the same.
  const rows = quietRowsWithEscape([]);
  assertLength(maximalRuns(rows), 0, "maximal runs on the posed board");
  assertTrue(areAdjacent(HELD, OFFERED), "R1 accepts the pair");
  assertTrue(!isPrism(rows, HELD), "the held cell carries no prism");
  assertTrue(!isPrism(rows, OFFERED), "the offered cell carries no prism");
  assertTrue(
    !swapIsLegal(rows, HELD, OFFERED),
    "R3 refuses the scenario's swap",
  );

  const posed = await loadBoard(h, rows);
  assertEqual(posed.phase, "idle", "the phase a swap may be requested from");

  const cues = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const played = await captureReplay(h, "refuse", async () => {
    // The press takes hold of the gem, on a frame of its own.
    const from = cellCenter(HELD.col, HELD.row);
    await h.press(from.x, from.y);
    await h.advance(1);
    assertDeepEqual(
      (await h.snapshot()).selection,
      HELD,
      "the cell the press took hold of",
    );
    const selectFrame = h.frame();

    // The carry offers it into the neighbor, on a frame of its own.
    const onto = cellCenter(OFFERED.col, OFFERED.row);
    await h.moveTo(onto.x, onto.y);
    await h.advance(1);
    assertDeepEqual(
      (await h.snapshot()).offer,
      OFFERED,
      "the cell the carry offered the held gem into",
    );

    // And the release is what asks for the move the rules turn down.
    await h.lift();
    await h.advance(1);
    return { selectFrame, releaseFrame: h.frame() };
  });

  // The event the cue is about really happened: specs/rules.md's own evidence
  // for a refusal — the two cells stand named, and nothing went into motion.
  const after = await h.snapshot();
  assertNotNull(after.refusal, "the refusal the request left standing");
  assertEqual(after.phase, "idle", "the phase after the refused swap");
  assertEqual(after.chainStep, 0, "the chain step after the refused swap");

  // "on no frame before it", in the two stretches that can be read for silence:
  // the settled board up to the press, on which nothing at all happens, and the
  // carry between the press and the release, which only moves an offer.
  assertLength(
    cues.filter((cue) => cue.frame < played.selectFrame),
    0,
    "one-shot cues on the frames before the press took hold of the gem",
  );
  assertLength(
    cues.filter(
      (cue) =>
        cue.frame > played.selectFrame && cue.frame < played.releaseFrame,
    ),
    0,
    `one-shot cues on the frames between the press at ${played.selectFrame} ` +
      `and the release`,
  );

  // And the refusing frame made a sound.
  assertGreaterThan(
    cuesOnFrame(cues, played.releaseFrame).length,
    0,
    "one-shot cues on the refusing frame",
  );
});
