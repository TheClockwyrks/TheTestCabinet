// Refract — instrumentation/overlay: the debug overlay reports the game, and
// watching it leaves the game as it is.
//
// specs/instrumentation.md "Diagnostics": the build registers its diagnostic
// sources through InitApi.diagnostics — at least the current screen and mode,
// the board's cols and rows, and each channel's beam length among them — and
// the engine draws one line per source when the overlay is toggled. Every
// source is a pure read, so watching the overlay leaves the game as it is.
// The toggle itself is the engine's backtick key (Backquote), dispatched on
// the engine's own input path.
//
// HOW THE LINES ARE READ. The engine draws the overlay after `render` through
// the same recorded context as everything else, so the check collects the
// text a steady frame draws WITHOUT the overlay, then the text the toggle's
// frame draws WITH it, and the difference is the overlay's lines. The board
// is 7x6 — the one dimension pair no beam length or menu figure collides
// with — carrying all three channels with beams of 2, 3, and 0 cells drawn.
// A source's rendering is the build's (a length may be counted in cells or
// in segments), so each length is accepted under either count.
//
// PURITY is read off the snapshot: identical before and after the toggle,
// apart from simTime, which must advance by exactly the toggle's one frame —
// time passing is the spec's own requirement of every update, overlay or not.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  loadBoard,
  resetTo,
  seconds,
  toggleOverlay,
  traceRoute,
  type Harness,
} from "../harness";

/**
 * A 7x6 board carrying all three channels: adjacent triangle emitters (a
 * 2-cell beam), a square emitter-lens-emitter run (a 3-cell beam), and
 * diamond emitters too far apart for any segment (a 0-cell beam).
 * Spec-derived, written in specs/board.md notation.
 */
const OVERLAY_BOARD = `
TT.....
SsS....
D.....D
.......
.......
.......
`;

/** The lines `after` drew beyond `before`, as a multiset difference. */
function newLines(before: string[], after: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of before) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return after.filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/** Some overlay line carries `token`, ignoring case; fails naming `what`. */
function assertSomeLine(
  lines: readonly string[],
  token: string,
  what: string,
): void {
  const wanted = token.toLowerCase();
  if (!lines.some((line) => line.toLowerCase().includes(wanted))) {
    fail(`an overlay line carrying ${what}`, lines);
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the registered diagnostics and changes nothing in the game", async () => {
  await resetTo(h, 1);
  await loadBoard(h, OVERLAY_BOARD);
  traceRoute(h, [
    [0, 0],
    [1, 0],
  ]);
  traceRoute(h, [
    [0, 1],
    [1, 1],
    [2, 1],
  ]);
  await h.advance(1);

  // A steady frame without the overlay, for the baseline text…
  h.calls.length = 0;
  await h.advance(1);
  const baseline = drawnText(h.calls);
  const before = h.snapshot();

  // …then the toggle's frame, with it.
  h.calls.length = 0;
  await toggleOverlay(h);
  captureStill(h, "overlay");
  const overlay = newLines(baseline, drawnText(h.calls));
  const after = h.snapshot();

  // The diagnostics the item names: the current screen and mode (spec-fixed
  // strings), the board's cols and rows (7 and 6, digits nothing else on
  // this board produces), and each channel's beam length (2, 3, and 0 cells
  // — or 1, 2, and 0 segments; either count is the value's honest reading).
  assertSomeLine(overlay, "playing", "the current screen, 'playing'");
  assertSomeLine(overlay, "campaign", "the current mode, 'campaign'");
  assertSomeLine(overlay, "7", "the board's cols, 7");
  assertSomeLine(overlay, "6", "the board's rows, 6");
  const lengths: ReadonlyArray<readonly [string, string, string]> = [
    ["triangle", "2", "1"],
    ["square", "3", "2"],
    ["diamond", "0", "0"],
  ];
  for (const [channel, cells, segments] of lengths) {
    const found = overlay.some(
      (line) => line.includes(cells) || line.includes(segments),
    );
    if (!found) {
      fail(
        `an overlay line carrying the ${channel} beam's length ` +
          `(${cells} cells or ${segments} segments)`,
        overlay,
      );
    }
  }

  // And the game is as it was: every source is a pure read, so the snapshot
  // is identical across the toggle apart from simTime, which advanced by
  // exactly the toggle's one frame.
  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "watching the overlay leaves the game as it is",
  );
  assertCloseTo(
    after.simTime - before.simTime,
    seconds(1),
    6,
    "simTime advances by exactly the toggle's one frame, nothing more",
  );
});
