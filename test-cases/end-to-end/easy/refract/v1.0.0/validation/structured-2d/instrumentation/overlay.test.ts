// Refract — instrumentation/overlay: the debug overlay reports the game, and
// watching it leaves the game as it is.
//
// Under this engine the overlay is engine chrome — the backtick key toggles
// it, and the engine draws the values the game REGISTERED as diagnostic
// sources (specs/instrumentation.md, Diagnostics: at least the current screen
// and mode, the board's cols and rows, and each channel's beam length). The
// overlay draws through the same context the harness records, so its lines
// are read as ordinary text runs; the lines the toggle ADDS over an otherwise
// still playing screen are the registered sources' lines.
//
// The board is GEO_7X6 — cols 7, rows 6, digits that appear on the board line
// and nowhere else on a quiet playing frame — with one triangle segment
// drawn, so the triangle beam's length is a real number the overlay must
// carry. What exact words a build's lines use is the build's; what is
// asserted is the specification's floor: a line reporting the screen value
// (the case-fixed "playing"), a line reporting the mode value, the board's
// cols and rows digits, and a channel-named line carrying a number.
//
// "The snapshot is identical before and after" is read with the one field the
// spec defines to move regardless: simTime accumulates the delta of every
// update whatever the screen, and toggling costs a frame — so simTime is
// compared as exactly that one frame's advance, and every other field must
// be identical.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertGreaterThan,
  fail,
} from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnText,
  loadBoard,
  resetTo,
  seconds,
  toggleOverlay,
  type Harness,
} from "../harness";

/** The first of `lines` containing `needle` (case-insensitive), or fail. */
function lineContaining(
  lines: readonly string[],
  needle: string,
  requirement: string,
): string {
  const wanted = needle.toLowerCase();
  const found = lines.find((line) => line.toLowerCase().includes(wanted));
  if (found === undefined) {
    fail(
      `an overlay line containing ${JSON.stringify(needle)} (${requirement})`,
      lines,
    );
  }
  return found;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("toggling draws the registered diagnostics and leaves the game as it is", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_7X6);
  // One drawn segment, so the triangle beam has a length to report.
  h.debug.trace([
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);

  // A baseline frame of the bare playing screen's own text.
  h.calls.length = 0;
  await h.advance(1);
  const bare = new Set(drawnText(h.calls));

  const before = h.snapshot();

  // Toggle the overlay up; the frame that lands it draws the panel's lines
  // through the same recorded context.
  h.calls.length = 0;
  await toggleOverlay(h);
  const overlaid = drawnText(h.calls);
  const added = overlaid.filter((line) => !bare.has(line));
  assertGreaterThan(added.length, 0, "the toggle draws new text runs");

  // Evidence: the overlay up over the posed board. (The engine draws the
  // overlay after the replay recorder's bracket closes, so a still is the
  // one capture that shows it.)
  captureStill(h, "overlay");

  // The diagnostics specs/instrumentation.md asks for, at the level the
  // specification fixes: the values, not any one build's wording.
  lineContaining(added, "playing", "the current screen");
  lineContaining(added, before.mode, "the current mode");
  lineContaining(added, "7", "the board's cols");
  lineContaining(added, "6", "the board's rows");
  const beamLine = lineContaining(
    added,
    "triangle",
    "the drawn channel's beam line",
  );
  if (!/\d/.test(beamLine)) {
    fail("a number on the triangle beam's overlay line (its length)", beamLine);
  }

  // A pure read: the snapshot is identical across the toggle, simTime moving
  // by exactly the one frame the toggle ran.
  const after = h.snapshot();
  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every field but simTime is identical with the overlay up",
  );
  assertCloseTo(
    after.simTime,
    before.simTime + seconds(1),
    6,
    "simTime advanced by exactly the toggle's one frame",
  );

  // Toggling again hides it: the added lines are gone, and the game is still
  // exactly as it was.
  h.calls.length = 0;
  await toggleOverlay(h);
  const downAgain = new Set(drawnText(h.calls));
  const lingering = added.filter((line) => downAgain.has(line));
  assertDeepEqual(lingering, [], "the overlay's lines leave with the toggle");
  const settled = h.snapshot();
  assertDeepEqual(
    { ...settled, simTime: 0 },
    { ...before, simTime: 0 },
    "every field but simTime is identical after the overlay comes down",
  );
});
