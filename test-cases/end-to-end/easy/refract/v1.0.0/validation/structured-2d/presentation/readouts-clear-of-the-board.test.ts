// Refract — presentation/readouts-clear-of-the-board: the readouts sit clear
// of the board.
//
// specs/ui.md "playing": inside the board's extent the screen draws only the
// board — its cells, the nodes with whatever readout a node itself carries, and
// the beams — and every other element of the screen sits clear of that extent,
// the mode's own readouts and the two controls included. specs/board.md gives
// the extent: the largest board's cell centers span x 352..928 and y 152..632,
// and every node's form reaches NODE_R (30) beyond its center. So the keep-out
// region is that extent widened by NODE_R on every side, and the check is that
// on a posed 7x6 board, in each mode, every run of text the frame draws sits
// outside it — nothing overlaps a node or a beam on the board that leaves the
// least room. GEO_7X6 carries no crystal, so nothing on it draws the one
// readout the extent is left open for.
//
// The text is read off the frame's own draw calls, each run's horizontal
// extent recovered from the transform, measured width, and alignment it was
// drawn with (the harness's drawnTextSpans). A run's VERTICAL extent is read
// at its anchor: the canvas does not record the glyphs' ascent, so a run
// violates the region when its glyph span crosses the widened x range while
// its anchor sits inside the widened y range. That is the deterministic
// reading available, and it is conservative toward the build — a run whose
// anchor sits just outside the band never fails, whatever its glyph height.
//
// Each mode is arranged by starting it and then posing the board over it
// (specs/instrumentation.md: loadBoard poses an arbitrary board and moves to
// playing; the mode is whatever was started, and each mode's own readouts are
// the ones that must sit clear).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  loadBoard,
  poseMode,
  resetTo,
  type Harness,
  type TextSpan,
} from "../harness";
import { NODE_R } from "../notation";
import type { Mode } from "../surface";

/** The board's extent — center span widened by NODE_R (specs/board.md). */
const KEEP_OUT = {
  left: 352 - NODE_R,
  right: 928 + NODE_R,
  top: 152 - NODE_R,
  bottom: 632 + NODE_R,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The spans of one freshly rendered frame, with nothing older mixed in. */
async function spansOfNextFrame(): Promise<TextSpan[]> {
  h.calls.length = 0;
  await h.advance(1);
  return drawnTextSpans(h);
}

/** Every span sits outside the keep-out region. */
function assertSpansClear(spans: TextSpan[], mode: string): void {
  for (const span of spans) {
    const crossesX = span.right > KEEP_OUT.left && span.left < KEEP_OUT.right;
    const insideY = span.y >= KEEP_OUT.top && span.y <= KEEP_OUT.bottom;
    if (crossesX && insideY) {
      fail(
        `every ${mode} text draw outside the board's widened extent, x ` +
          `${KEEP_OUT.left}..${KEEP_OUT.right} by y ${KEEP_OUT.top}..` +
          `${KEEP_OUT.bottom} (specs/ui.md: the readouts sit clear of the ` +
          `board)`,
        `${JSON.stringify(span.text)} drawn at x ${span.left.toFixed(0)}..` +
          `${span.right.toFixed(0)}, y ${span.y.toFixed(0)}`,
      );
    }
  }
}

async function poseLargestBoard(mode: Mode): Promise<void> {
  await resetTo(h, 1);
  await poseMode(h, mode);
  await loadBoard(h, GEO_7X6);
  const snapshot = h.snapshot();
  assertEqual(snapshot.screen, "playing", `${mode}: the posed board is up`);
  assertEqual(snapshot.mode, mode, `${mode}: the mode whose readouts show`);
}

it("keeps every campaign text draw clear of the largest board", async () => {
  await poseLargestBoard("campaign");
  const spans = await spansOfNextFrame();
  // The largest board with its readouts clear.
  captureStill(h, "playing");
  assertSpansClear(spans, "campaign");
});

it("keeps every cascade text draw clear of the largest board", async () => {
  await poseLargestBoard("cascade");
  const spans = await spansOfNextFrame();
  assertSpansClear(spans, "cascade");
});
