// cascade/boards-are-well-formed — every generated board keeps the generator's
// contract.
//
// specs/modes/cascade.md "The generator": each emitted board is a grid within
// GRID_MAX_COLS (7) x GRID_MAX_ROWS (6); the channels present are the first n
// of CHANNELS; every channel present carries exactly two emitters; and a
// crystal's charges are 1 to MAX_CHARGES (3). The sweep reads each board off
// the snapshot as it arrives and holds it to exactly that table — solving as it
// goes (the only way the sequence advances), with a different seed from the
// solvability sweep so the two points read different draws of the generator.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  CHANNELS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  MAX_CHARGES,
  channelsPresent,
} from "../notation";
import {
  captureStill,
  createHarness,
  solveGenerated,
  type Harness,
} from "../harness";

const SWEEP = 20;
const SEED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("every board of the sweep fits the grid, the channel rule, and the charge range", async () => {
  const sweep = await solveGenerated(
    h,
    SWEEP,
    SEED,
    async (_snapshot, index) => {
      if (index === SWEEP - 1) await captureStill(h, "board");
    },
  );

  for (const [index, board] of sweep.boards.entries()) {
    const at = `board ${index + 1}`;

    assertBetween(board.cols, 1, GRID_MAX_COLS, `${at}: cols`);
    assertBetween(board.rows, 1, GRID_MAX_ROWS, `${at}: rows`);

    // The channels present are the first n of CHANNELS.
    const present = channelsPresent(board);
    assertGreaterThanOrEqual(present.length, 1, `${at}: channels present`);
    assertDeepEqual(
      present,
      CHANNELS.slice(0, present.length),
      `${at}: the channels are the first n of CHANNELS`,
    );

    // Exactly two emitters for each channel present.
    for (const channel of present) {
      const emitters = board.nodes.filter(
        (node) => node.kind === "emitter" && node.channel === channel,
      ).length;
      assertEqual(emitters, 2, `${at}: emitters of ${channel}`);
    }

    // Every crystal carries 1 to MAX_CHARGES charges.
    for (const node of board.nodes) {
      if (node.kind !== "crystal") continue;
      const where = `${at}: crystal at (${node.col}, ${node.row})`;
      assertNotNull(node.charges, `${where}: charges`);
      assertBetween(node.charges ?? 0, 1, MAX_CHARGES, `${where}: charges`);
    }
  }
});
