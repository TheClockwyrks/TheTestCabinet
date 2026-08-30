// board/silhouettes-distinct — the three channel silhouettes are told apart by
// form.
//
// specs/board.md pins the silhouettes — triangle, square, diamond — so channel
// identity reads by form as well as by hue, while the hues themselves are the
// build's. So the reading is hue-independent: each lens's BODY within NODE_R of
// its center, and the three bodies compared pairwise by
// intersection-over-union after centroid alignment. Two genuinely different
// silhouettes overlap well below 0.85; three copies of one shape recolored
// overlap near 1. Whether each body is exactly the triangle, the square, and
// the diamond is visible to the reviewer in the captured frame; what is decided
// here is the part decidable without shape recognition — that the three forms
// differ.
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
// The lenses sit on the top row, two cells apart, so each disk reads one
// form alone; the emitters every present channel must carry sit two rows
// below, a full 192 px from every sampled disk.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { cellCenter, CHANNELS, NODE_R } from "../notation";
import {
  bodyArea,
  bodyIoU,
  bodyMask,
  groundSample,
  type BodyMask,
} from "./sampling";

/** One lens of each channel on the top row; the required emitters below. */
const THREE_LENSES = `
t.s.d..
.......
TTSSDD.
`;

/** The item's ceiling on how alike two distinct silhouettes may read. */
const IOU_MAX = 0.85;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the three lens silhouettes as bodies that overlap below 0.85 pairwise", async () => {
  const board = await loadBoard(h, THREE_LENSES);
  await captureStill(h, "nodes");
  const ground = await groundSample(h, board);

  const bodies: BodyMask[] = [];
  for (const [index, channel] of CHANNELS.entries()) {
    const at = cellCenter(index * 2, 0, board.cols, board.rows);
    const body = await bodyMask(h, at.x, at.y, NODE_R, ground);
    // A body with nothing in it is not a distinct silhouette, it is a lens
    // that never rendered a visible form at all — and an empty body would
    // overlap everything by zero and pass. specs/board.md draws a lens as the
    // filled silhouette of its channel, so there is form here to compare.
    assertGreaterThan(
      bodyArea(body),
      0,
      `the ${channel} lens renders a visible form within NODE_R of its center`,
    );
    bodies.push(body);
  }

  for (let a = 0; a < bodies.length; a += 1) {
    for (let b = a + 1; b < bodies.length; b += 1) {
      assertLessThan(
        bodyIoU(bodies[a], bodies[b]),
        IOU_MAX,
        `body overlap (IoU, centroid-aligned) of ${CHANNELS[a]} against ${CHANNELS[b]}`,
      );
    }
  }
});
