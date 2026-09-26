// Refract — tracing/extend: dragging to an adjacent node adds a segment.
//
// `specs/controls.md` "Extending": while the trace is held, the pointer moving
// within NODE_HIT_R (44) of a node adjacent to the live end adds the segment
// joining them, when the rules permit it, and that node becomes the new live
// end. The move lands 40 out from the lens's center — inside the radius but
// nowhere near the center — so the figure asserted is the radius itself; a
// waypoint between the two nodes, past NODE_HIT_R from both, adds nothing on
// the way.
//
// The declared output is a REPLAY, so the drag is a real mouse drag: the
// harness's mouse helpers drive one frame per sample (a pointer op alone
// drives none, and a section with no frames writes no recording), and the
// capture wraps exactly the drag the item is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R3_REDRAW } from "../fixtures";
import { NODE_HIT_R } from "../notation";
import {
  captureReplay,
  center,
  createHarness,
  loadBoard,
  mouseGlide,
  mousePress,
  mouseRelease,
  type Harness,
  type RefractSnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds the segment to the adjacent node and moves the live end", async () => {
  const board = await loadBoard(h, R3_REDRAW);
  const a = center(board, { col: 0, row: 0 });
  const b = center(board, { col: 1, row: 0 });

  const swept = await captureReplay(h, "extend", async () => {
    await mousePress(h, a.x, a.y);
    await h.advance(6);

    // Halfway between the two centers: 48 from each, past NODE_HIT_R from
    // every node, so the beam is still the one pressed cell.
    await mouseGlide(h, (a.x + b.x) / 2, a.y);
    const between: RefractSnapshot = await h.snapshot();
    await h.advance(6);

    // Within NODE_HIT_R of the lens — 40 out from its center — the segment
    // joining it to the live end is added.
    await mouseGlide(h, b.x - (NODE_HIT_R - 4), b.y);
    const extended: RefractSnapshot = await h.snapshot();
    await h.advance(6);

    await mouseRelease(h);
    return { between, extended };
  });

  assertDeepEqual(
    swept.between.beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "a move past NODE_HIT_R from every center adds nothing",
  );
  assertDeepEqual(
    swept.extended.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "a move within NODE_HIT_R of the adjacent node adds the segment",
  );
  assertDeepEqual(
    swept.extended.tracing,
    { channel: "triangle", live: { col: 1, row: 0 } },
    "that node becomes the live end",
  );
});
