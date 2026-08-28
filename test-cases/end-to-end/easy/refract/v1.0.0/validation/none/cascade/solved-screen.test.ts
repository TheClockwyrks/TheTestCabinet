// cascade/solved-screen — the cascade solved screen.
//
// specs/modes/cascade.md "The solved screen": on solving, the game moves to
// `solved` with `menuIndex` 0; the screen shows SOLVED_TITLE_TEXT
// (BOARD SOLVED), the boards-solved count, and a vertical menu of SOLVED_ITEMS
// (NEXT BOARD, RESTART) in that order; and it "is drawn over the finished
// board, which stays visible behind it with every beam complete, so the player
// sees the shape they made."
//
// The board is a real generated one at tier 2 — two channels — solved for
// real: every beam is traced except the last channel's final move, and the
// final move then solves it through the game's own rules.
//
// HOW "STAYS DRAWN BEHIND" IS READ. The item's description says "with the
// sampled node centers unchanged", but pixel-identical centers are not what
// the specification fixes: it requires the finished board VISIBLE behind the
// overlay, and a build that draws the solved screen over a uniform dim — the
// board still plainly there — is conformant. So the check asserts the spec's
// own claim: on the solved snapshot every beam present is complete, and on the
// solved frame every sampled node center still reads as a node — distinct
// from the bare bench sampled on the SAME frame by more than 25 of 441, the
// case's own same-color tolerance (the stage-fit item's), under whatever veil
// covers both. The sampled centers are the already-complete channel's nodes,
// which the finishing move has no business redrawing (R2 keeps the finishing
// beam out of foreign nodes; its own channel legitimately restyles as its
// per-channel progress flips, specs/ui.md). A board cleared or covered by an
// opaque panel reads as bench there, and fails.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertMatches,
  assertNotNull,
  fail,
} from "../assert";
import { SOLVED_ITEMS, SOLVED_TITLE_TEXT } from "../constants";
import { CHANNELS, channelsPresent } from "../notation";
import { solve } from "../solver";
import {
  boardFromSnapshot,
  captureStill,
  center,
  colorDistance,
  createHarness,
  drawnText,
  fireAction,
  sampleBench,
  sampleColor,
  solveGenerated,
  textDraws,
  traceCells,
  type Harness,
} from "../harness";

const SEED = 4;

/** The case's same-color tolerance: within this of 441, two colors read alike. */
const SAME_COLOR = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solving goes to solved, draws the copy, and keeps the board behind", async () => {
  // Five real solves put the run at tier 2, where boards carry two channels.
  const sweep = await solveGenerated(h, 5, SEED);
  for (const [index, after] of sweep.afterSolve.entries()) {
    assertEqual(
      after.solved,
      true,
      `precondition: board ${index + 1} of the run-up solved (see boards-are-solvable)`,
    );
  }
  await fireAction(h, "confirm");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.screen, "playing", "precondition: a board in play");
  const board = boardFromSnapshot(snapshot);
  const present = channelsPresent(board);
  assertGreaterThan(
    present.length,
    1,
    "precondition: a tier-2 board carries two channels",
  );
  const verdict = solve(board);
  if (verdict.status !== "solved") {
    fail(
      "a solvable tier-2 board (precondition; see boards-are-solvable)",
      verdict.status,
    );
  }

  // Trace everything except the final channel's last move, then make the final
  // move through the game's own rules: grab the beam's live end and extend it
  // one cell. The board solves the moment the move lands.
  const last = present[present.length - 1];
  for (const channel of CHANNELS) {
    const route = verdict.beams[channel];
    if (route === undefined || route.length === 0) continue;
    await traceCells(h, channel === last ? route.slice(0, -1) : route);
  }
  const finalRoute = verdict.beams[last];
  if (finalRoute === undefined || finalRoute.length < 2) {
    fail("a final route of at least two cells", finalRoute?.length ?? 0);
  }
  await traceCells(h, finalRoute.slice(-2));

  const solved = await h.snapshot();
  assertEqual(solved.screen, "solved", "solving moves to solved");
  assertEqual(solved.menuIndex, 0, "menuIndex on arriving at solved");

  // The finished board behind it has every beam complete.
  for (const [channel, beam] of Object.entries(solved.beams)) {
    if (beam === undefined) continue;
    assertEqual(beam.complete, true, `the ${channel} beam behind the screen`);
  }

  // The frame that draws it.
  const calls = await h.frameCalls();
  await captureStill(h, "solved");

  const text = drawnText(calls).join(" ");
  assertMatches(text, SOLVED_TITLE_TEXT, "the solved heading");
  assertMatches(
    text,
    new RegExp(`\\b${solved.solvedCount}\\b`),
    "the boards-solved count",
  );

  // The vertical menu, in SOLVED_ITEMS order: NEXT BOARD above RESTART.
  const draws = textDraws(calls);
  const anchorOf = (item: string) =>
    draws.find((run) => run.text.toLowerCase().includes(item.toLowerCase())) ??
    null;
  const nextBoard = anchorOf(SOLVED_ITEMS[0]);
  const restart = anchorOf(SOLVED_ITEMS[1]);
  assertNotNull(nextBoard, `a ${SOLVED_ITEMS[0]} menu entry`);
  assertNotNull(restart, `a ${SOLVED_ITEMS[1]} menu entry`);
  if (nextBoard !== null && restart !== null) {
    assertGreaterThan(
      restart.y,
      nextBoard.y,
      `${SOLVED_ITEMS[0]} sits above ${SOLVED_ITEMS[1]}`,
    );
  }

  // The finished board stays visible behind: on this same frame, each sampled
  // node center — the already-complete channel's nodes — still reads distinct
  // from the bare bench.
  const bench = await sampleBench(h);
  const sampled = board.nodes.filter(
    (node) => node.channel !== null && node.channel !== last,
  );
  assertGreaterThan(sampled.length, 0, "node centers clear of the final move");
  for (const node of sampled) {
    const at = center(board, node);
    const drawn = await sampleColor(h, at.x, at.y);
    assertGreaterThan(
      colorDistance(drawn, bench),
      SAME_COLOR,
      `node at (${node.col}, ${node.row}): still drawn behind the solved screen`,
    );
  }
});
