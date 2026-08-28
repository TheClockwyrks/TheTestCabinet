// board/beam-route — a drawn beam visibly connects the cells it links.
//
// specs/board.md: a drawn beam visibly connects the centers of the cells it
// links, so its route is unambiguous, and it carries its channel's hue;
// specs/ui.md draws every segment in its channel's hue on the playing screen.
// The rendering is otherwise the build's, so the reading is at the geometry
// the spec fixes: the midpoint of an orthogonal and of a diagonal segment, on
// two different channels — the point every straight center-to-center segment
// passes through, comfortably clear of the node forms at either end. Each
// midpoint stands more than 50 of 441 apart from the bench, and sits closer
// in RGB to its own channel's sampled fill than to either other channel's,
// read against all three channels posed on the board.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  center,
  colorDistance,
  createHarness,
  loadBoard,
  sampleBench,
  sampleColor,
  segmentMidpoint,
  traceCells,
  type Harness,
  type Rgb,
} from "../harness";
import { type Channel } from "../notation";
import { DISTINCT_MIN } from "./sampling";

/**
 * All three channels posed: triangle down the left column (an orthogonal
 * segment T(0,0)-t(0,1)), square by a diagonal (S(1,0)-s(2,1)), and diamond
 * present on the right for its fill color alone.
 */
const THREE_CHANNEL_BOARD = `
TS.D
t.sd
TS.D
`;

/** Where each channel's fill is sampled: a lens off both routes' midpoints. */
const LENS_CELLS: Record<Channel, { col: number; row: number }> = {
  triangle: { col: 0, row: 1 },
  square: { col: 2, row: 1 },
  diamond: { col: 3, row: 1 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The midpoint sits nearer its own channel's fill than either other's. */
function assertNearestOwnHue(
  midpoint: Rgb,
  own: Channel,
  fills: Record<Channel, Rgb>,
  what: string,
): void {
  const toOwn = colorDistance(midpoint, fills[own]);
  for (const other of Object.keys(fills) as Channel[]) {
    if (other === own) continue;
    assertLessThan(
      toOwn,
      colorDistance(midpoint, fills[other]),
      `${what}: nearer the ${own} fill than the ${other} fill in RGB`,
    );
  }
}

it("draws an orthogonal and a diagonal segment through their midpoints, each in its channel's hue", async () => {
  const board = await loadBoard(h, THREE_CHANNEL_BOARD);
  const bench = await sampleBench(h);

  // Each channel's fill, sampled from a lens BEFORE anything is traced, so no
  // beam's own pixels color the reference readings.
  const fills = {} as Record<Channel, Rgb>;
  for (const [channel, cell] of Object.entries(LENS_CELLS) as [
    Channel,
    { col: number; row: number },
  ][]) {
    const at = center(board, cell);
    fills[channel] = await sampleColor(h, at.x, at.y);
  }

  // One orthogonal triangle segment, one diagonal square segment, both from
  // an emitter of a channel whose beam is empty, then the frame that renders
  // them.
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 0, row: 1 },
  ]);
  await traceCells(h, [
    { col: 1, row: 0 },
    { col: 2, row: 1 },
  ]);
  await h.advance(1);
  await captureStill(h, "beams");

  const orthoMid = segmentMidpoint(
    board,
    { col: 0, row: 0 },
    { col: 0, row: 1 },
  );
  const diagMid = segmentMidpoint(
    board,
    { col: 1, row: 0 },
    { col: 2, row: 1 },
  );
  const ortho = await sampleColor(h, orthoMid.x, orthoMid.y);
  const diag = await sampleColor(h, diagMid.x, diagMid.y);

  assertGreaterThan(
    colorDistance(ortho, bench),
    DISTINCT_MIN,
    "the orthogonal segment's midpoint against the bench",
  );
  assertGreaterThan(
    colorDistance(diag, bench),
    DISTINCT_MIN,
    "the diagonal segment's midpoint against the bench",
  );

  assertNearestOwnHue(ortho, "triangle", fills, "the orthogonal midpoint");
  assertNearestOwnHue(diag, "square", fills, "the diagonal midpoint");
});
