// Refract — tracing/extend: dragging to an adjacent node adds a segment.
//
// specs/controls.md "Extending": while the trace is held, the pointer moving
// within NODE_HIT_R (44) of a node adjacent to the live end adds the segment
// joining them, when the rules in specs/beams.md permit it, and that node
// becomes the new live end.
//
// The board is R9_UNIQUE (fixtures.ts); both segments drawn are legal, so the
// permit clause is satisfied and what is measured is the extension itself.
// Each move lands NODE_HIT_R - 2 from its target's center — never ON the
// center — so passing requires the radius, not just center hits. The whole
// held drag is recorded as the item's `extend` replay, with frames advanced
// between the poses so the recording shows the beam growing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { NODE_HIT_R } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds the segment to the adjacent node and makes it the live end, within NODE_HIT_R", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R9_UNIQUE);

  await captureReplay(h, "extend", async () => {
    const start = nodeCenter(0, 0, 4, 3);
    h.debug.pointerDown(start.x, start.y);
    await h.advance(6);

    // Toward t(0,1), stopping NODE_HIT_R - 2 above its center: within the
    // radius of the target, and 96 - 42 = 54 from the live end behind it.
    const first = nodeCenter(0, 1, 4, 3);
    h.debug.pointerMove(first.x, first.y - (NODE_HIT_R - 2));
    await h.advance(6);

    const one = h.snapshot();
    assertNotNull(one.tracing, "the trace is still held after the move");
    assertDeepEqual(
      one.beams.triangle?.cells,
      [
        { col: 0, row: 0 },
        { col: 0, row: 1 },
      ],
      "a move within NODE_HIT_R of a node adjacent to the live end adds " +
        "the segment joining them (specs/controls.md, Extending)",
    );
    assertDeepEqual(
      one.tracing?.live,
      { col: 0, row: 1 },
      "the reached node becomes the new live end",
    );

    // On to t(1,1), again NODE_HIT_R - 2 short of its center.
    const second = nodeCenter(1, 1, 4, 3);
    h.debug.pointerMove(second.x - (NODE_HIT_R - 2), second.y);
    await h.advance(6);

    const two = h.snapshot();
    assertDeepEqual(
      two.beams.triangle?.cells,
      [
        { col: 0, row: 0 },
        { col: 0, row: 1 },
        { col: 1, row: 1 },
      ],
      "each further move adds the segment to the next adjacent node",
    );
    assertDeepEqual(
      two.tracing?.live,
      { col: 1, row: 1 },
      "the live end follows the drag",
    );

    h.debug.pointerUp();
    await h.advance(6);
  });
});
