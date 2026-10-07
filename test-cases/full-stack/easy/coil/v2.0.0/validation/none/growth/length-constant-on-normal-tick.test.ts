// growth/length-constant-on-normal-tick — a tick that eats nothing leaves the
// length alone.
//
// specs/movement.md: step 4, "Otherwise prepend the new head and drop the tail
// cell", and the rule, "On every tick that eats nothing the length is unchanged:
// one cell joins at the head and one leaves at the tail."
//
// The counterpart of `grows-by-one`, and it needs its own point because the two
// halves of step 4 are two different branches of a build. A build that never drops
// the tail grows without eating and fills the board on its own; a build that drops
// it twice shrinks away to nothing.
//
// SEVERAL TICKS RATHER THAN ONE, because a length that is right for one tick and
// drifts afterwards is the failure that is hard to see, and because the cell the
// tail released is read each time: a chain that keeps its length by holding onto
// its tail cell and dropping some other one is a chain with a gap in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { type Cell } from "../constants";
import {
  arrangeStep,
  captureReplay,
  createHarness,
  holdsCell,
  type Harness,
} from "../harness";

/** Where the chain is posed: a clear run of more than TICKS cells to its right. */
const HEAD: Cell = { col: 5, row: 8 };

/** The length posed, and the length every tick has to leave. */
const LENGTH = 5;

/** Ticks driven over open board with no pellet on it. */
const TICKS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the chain's length, and releases the tail cell, every tick", async () => {
  const posed = await arrangeStep(h, {
    head: HEAD,
    dir: "right",
    length: LENGTH,
    pellet: null,
  });
  assertEqual(posed.snapshot.pellet, null, "the board the ticks run over");

  await captureReplay(h, "steady", async () => {
    let snapshot = posed.snapshot;
    for (let tick = 1; tick <= TICKS; tick += 1) {
      const releasing = snapshot.snake[snapshot.snake.length - 1];
      snapshot = await h.tick();
      assertLength(snapshot.snake, LENGTH, `the chain after tick ${tick}`);
      assertEqual(
        holdsCell(snapshot.snake, releasing),
        false,
        `the cell the tail left on tick ${tick}`,
      );
    }
  });
});
