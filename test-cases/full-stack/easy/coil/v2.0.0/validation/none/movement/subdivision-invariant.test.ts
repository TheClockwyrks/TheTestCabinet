// movement/subdivision-invariant — the tick is driven by elapsed time, not by
// frames.
//
// specs/movement.md: "The game accumulates the delta time the runtime hands each
// update and runs one tick for each whole `TICK_SECONDS` the accumulator holds,
// leaving the remainder to carry into the next update. Ticks are therefore driven
// by elapsed time rather than by frames, and a second of game time is eight ticks
// whether the runtime delivered it in one update or in sixty."
// specs/instrumentation.md says the same of the operation this point drives:
// "`advance(1, 1)` and `advance(1, 60)` both run eight ticks and reach the same
// state."
//
// WHY THE TWO RUNS ARE POSED SEPARATELY AND COMPARED TO EACH OTHER. The claim is
// an equality between two deliveries rather than a figure, so what is read is the
// pair: the same second, cut two ways, over the same posed world. `constant-rate`
// is the point that decides the figure itself, and a build that resolved seven
// ticks either way fails there rather than here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { type Cell } from "../constants";
import {
  arrangeStep,
  captureReplay,
  createHarness,
  type CoilSnapshot,
  type Harness,
} from "../harness";
import { deliver } from "./updates";

/** Where the chain is posed: a clear run of more than eight cells to its right. */
const HEAD: Cell = { col: 5, row: 8 };

/** The stretch of game time each run is handed. */
const SECONDS = 1;

/** The many-updates division, as specs/movement.md words it. */
const UPDATES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What a delivery of `SECONDS` left behind: the ticks it resolved and the head. */
function reached(snapshot: CoilSnapshot): { ticks: number; head: Cell } {
  return { ticks: snapshot.ticks, head: snapshot.snake[0] };
}

it("reaches the same state from one update as from sixty", async () => {
  await arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  await deliver(h, SECONDS, 1);
  const whole = reached(await h.snapshot());

  // The same world again, posed from scratch, so the second run inherits nothing
  // from the first but the build's own code.
  await arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  const divided = await captureReplay(h, "divided", async () => {
    await deliver(h, SECONDS, UPDATES);
    return reached(await h.snapshot());
  });

  assertEqual(divided.ticks, whole.ticks, `ticks from ${UPDATES} updates`);
  assertDeepEqual(divided.head, whole.head, `the head from ${UPDATES} updates`);
});
