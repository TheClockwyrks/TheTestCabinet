// Refract — board/crystal-distinct: a crystal is never mistaken for a channel
// node.
//
// specs/board.md "Nodes": a crystal is drawn as a form clearly distinct from
// all three channel silhouettes — it is channel-neutral, and a player who read
// it as a triangle, square, or diamond would look for a beam that owns it. The
// mechanical reading is the same body comparison as silhouettes-distinct, with
// the crystal on one side of every pair: its BODY within NODE_R (30) of its
// center must overlap each channel silhouette's body by an
// intersection-over-union below 0.85 after centroid alignment.
//
// THE BODY IS BINARIZED RELATIVELY, at half the form's own strongest reading
// against the board's own ground. specs/board.md grants a build node artwork
// around the silhouette — "a halo, a backing, a highlight", item 4 of
// "Presentation is yours" — out to CELL_PITCH / 2 (48), and an absolute cut
// admits every pixel of a soft glow as silhouette, so three differently shaped
// forms wearing one glow read as one form. The relative cut reads the
// silhouettes the specification pins and leaves out the ornament it grants. It
// does not loosen the comparison: a build that draws all three channels as one
// square reads 1.000 under either cut.
//
// One lens per channel and one crystal share the middle row of a legal board
// (each channel's two emitters sit directly above and below its lens), so all
// four bodies come off one frame; the lens is each channel's FILLED
// silhouette, the form itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R } from "../notation";
import { bodyArea, bodyIoU, bodyMask, groundSample } from "./pixels";

/** The item's overlap ceiling: at or above this, two forms read as one. */
const IOU_MAX = 0.85;

/** One lens per channel and a 2-charge crystal, two cells apart on one row. */
const LINE_UP = `
T.S.D..
t.s.d.2
T.S.D..
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("draws a crystal that overlaps no channel silhouette as one form", async () => {
  const board = await loadBoard(h, LINE_UP);
  // A crystal beside the three channel nodes.
  captureStill(h, "crystal");

  const ground = groundSample(h, board);
  const bodies = board.nodes
    .filter((node) => node.kind !== "emitter")
    .map((node) => {
      const center = cellCenter(node.col, node.row, board.cols, board.rows);
      return {
        name: node.kind === "crystal" ? "crystal" : String(node.channel),
        kind: node.kind,
        body: bodyMask(h, center.x, center.y, NODE_R, ground),
      };
    });
  for (const { name, body } of bodies) {
    // A form that is not there at all cannot be told apart from anything; an
    // empty body is its own verdict before any pair is compared.
    assertGreaterThan(
      bodyArea(body),
      0,
      `the ${name} node draws a form within NODE_R of its center`,
    );
  }

  const crystal = bodies.find((entry) => entry.kind === "crystal");
  if (crystal === undefined) throw new Error("the posed row holds a crystal");
  for (const lens of bodies.filter((entry) => entry.kind === "lens")) {
    assertLessThan(
      bodyIoU(crystal.body, lens.body),
      IOU_MAX,
      `the crystal and the ${lens.name} silhouette, centroid-aligned, read ` +
        `as different forms`,
    );
  }
});
