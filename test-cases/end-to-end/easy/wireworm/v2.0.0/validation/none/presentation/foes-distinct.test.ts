// Wireworm — presentation/foes-distinct: the three foes read apart.
//
// specs/overview.md's legibility table: "The glitch, the dropper, and the
// corruptor read apart from one another and from the board." The three do
// different things to the field (specs/foes.md — one eats it, one reseeds it,
// one slams it to critical), so a player who cannot tell which one is crossing
// the board cannot decide which to shoot first. The specification fixes no
// palette, so what is checked is DISTANCE: pairwise between the three, and
// between each of them and a bare tile of the board.
//
// EACH FOE IS POSED WITH BOTH FACULTIES OFF. This point is about what a foe
// looks like, not about what it does or where it goes, so `travel` is off — the
// foe holds the tile it was placed on — and `mind` is off — it eats nothing,
// lays nothing and slams nothing. That is the isolation the reading needs: the
// three are read as three pictures side by side, and no faculty of one can
// disturb the tile another is read on.
//
// They are posed ten tiles apart along one mid-board row, which is `320` logical
// units — far past any glow a build could lay around a `32`-unit sprite — and
// the board's own colour is read from a bare tile on the same row.
//
// The colour of a foe and of the bare board is the colour of its LIT MARK, read
// as `presentation/reading` explains, so a foe and the ground behind it are
// compared like with like.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  foeById,
  poseFoe,
  startPlaying,
  type FoeKind,
  type Harness,
  type Rgb,
} from "../harness";
import { litTile, rgb } from "./reading";

/**
 * How far apart two foes, and a foe and the board, must read, as a Euclidean
 * RGB distance out of the `441` an RGB cube is across. The case's figure, since
 * the specification states the rule and leaves the palette to the build: `40` is
 * about a tenth of the space, which is the least a player reads at a glance.
 */
const DISTINCT_MIN = 40;

/** The row the three foes are posed on: mid-board, clear of the band. */
const FOE_ROW = 10;

/** Each foe's kind and the column it is posed in, ten tiles apart. */
const POSED: readonly { kind: FoeKind; column: number }[] = [
  { kind: "glitch", column: 6 },
  { kind: "dropper", column: 16 },
  { kind: "corruptor", column: 26 },
];

/** A bare tile on the same row: the board the three are read against. */
const BARE_COLUMN = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the three foes apart from one another and from the board", async () => {
  await startPlaying(h);
  const posed: { kind: FoeKind; column: number; id: number }[] = [];
  for (const { kind, column } of POSED) {
    const id = await poseFoe(h, kind, column, FOE_ROW, {
      travel: false,
      mind: false,
    });
    posed.push({ kind, column, id });
  }
  await h.advance(1);
  // The three foes side by side, as the build drew them.
  await captureStill(h, "foes");

  const snapshot = await h.snapshot();
  const sampled: { kind: FoeKind; colour: Rgb }[] = [];
  for (const { kind, column, id } of posed) {
    assertEqual(
      foeById(snapshot, id)?.kind,
      kind,
      `the ${kind} posed at (${column}, ${FOE_ROW}) is on the board`,
    );
    sampled.push({ kind, colour: await litTile(h, column, FOE_ROW) });
  }

  const board = await litTile(h, BARE_COLUMN, FOE_ROW);
  for (const { kind, colour } of sampled) {
    assertGreaterThan(
      colorDistance(colour, board),
      DISTINCT_MIN,
      `the ${kind} to differ from the board behind it by more than ` +
        `${DISTINCT_MIN} of 441 (specs/overview.md: the three foes read apart ` +
        `from the board); the ${kind} sampled ${rgb(colour)} and the bare ` +
        `tile at (${BARE_COLUMN}, ${FOE_ROW}) sampled ${rgb(board)}`,
    );
  }

  for (let first = 0; first < sampled.length; first += 1) {
    for (let second = first + 1; second < sampled.length; second += 1) {
      const a = sampled[first];
      const b = sampled[second];
      assertGreaterThan(
        colorDistance(a.colour, b.colour),
        DISTINCT_MIN,
        `the ${a.kind} and the ${b.kind} to differ by more than ` +
          `${DISTINCT_MIN} of 441 (specs/overview.md: the glitch, the dropper ` +
          `and the corruptor read apart from one another); the ${a.kind} ` +
          `sampled ${rgb(a.colour)} and the ${b.kind} sampled ${rgb(b.colour)}`,
      );
    }
  }
});
