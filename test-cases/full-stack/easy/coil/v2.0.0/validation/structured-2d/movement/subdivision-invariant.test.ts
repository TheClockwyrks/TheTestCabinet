// movement/subdivision-invariant — the tick is driven by elapsed time, not by
// frames.
//
// specs/movement.md: "The game accumulates the delta time the runtime hands each
// update and runs one tick for each whole `TICK_SECONDS` the accumulator holds,
// leaving the remainder to carry into the next update. Ticks are therefore driven
// by elapsed time rather than by frames, and a second of game time is eight ticks
// whether the runtime delivered it in one update or in sixty."
//
// WHY THE TWO RUNS ARE POSED SEPARATELY AND COMPARED TO EACH OTHER. The claim is
// an equality between two deliveries rather than a figure, so what is read is the
// pair: the same stretch of game time, cut two ways, over the same posed world.
// `constant-rate` is the point that decides the figure itself, and a build that
// resolved the wrong number of ticks either way fails there rather than here.
//
// WHY THE STRETCH IS NOT A WHOLE NUMBER OF TICKS. Sixty equal frames of a stretch
// cannot sum to it exactly in binary, and a stretch that ends exactly on a tick
// boundary would have the last bit of that sum decide whether the final tick
// resolves — which says nothing about a build. So the stretch is a second and a
// half-tick, which lands the pair half a tick clear of the nearest boundary and
// leaves both deliveries deciding the same eight ticks by the rule rather than by
// rounding.

import { afterEach, it } from "vitest";
import { ConstantClock } from "@test-cabinet/structured-2d";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { TICK_SECONDS } from "../../src/constants";
import {
  arrangeStep,
  captureReplay,
  createHarness,
  type Cell,
  type CoilSnapshot,
  type Harness,
} from "../harness";

/** Where the chain is posed: a clear run of more than eight cells to its right. */
const HEAD: Cell = { col: 5, row: 8 };

/** The stretch of game time each run is handed, in milliseconds. */
const STRETCH_MS = (1 + TICK_SECONDS / 2) * 1000;

/** The many-updates division, as specs/movement.md words it. */
const UPDATES = 60;

const live: Harness[] = [];

afterEach(() => {
  while (live.length > 0) live.pop()?.dispose();
});

/** What a delivery of the stretch left behind: the ticks it resolved, and the head. */
function reached(snapshot: CoilSnapshot): { ticks: number; head: Cell } {
  return { ticks: snapshot.ticks, head: snapshot.snake[0] };
}

/**
 * Pose the same world on a runtime whose frames are the stretch divided
 * `updates` ways, hand it exactly that many frames, and read what it reached.
 *
 * `replay` names the review item's output when this is the delivery whose frames
 * are kept as evidence, and is absent for the one it is only compared against.
 */
async function deliver(
  updates: number,
  replay?: string,
): Promise<{ ticks: number; head: Cell }> {
  const harness = await createHarness({
    clock: new ConstantClock(STRETCH_MS / updates),
  });
  live.push(harness);
  arrangeStep(harness, { head: HEAD, dir: "right", length: 3 });

  const drive = async (): Promise<{ ticks: number; head: Cell }> => {
    await harness.advance(updates);
    return reached(harness.snapshot());
  };
  return replay === undefined ? drive() : captureReplay(harness, replay, drive);
}

it("reaches the same state from one update as from sixty", async () => {
  const whole = await deliver(1);
  // The comparison only means something if the stretch resolved ticks at all, so
  // that much is read off the reference delivery before the pair is compared.
  assertGreaterThan(whole.ticks, 0, "ticks the single update resolved");

  const divided = await deliver(UPDATES, "divided");

  assertEqual(divided.ticks, whole.ticks, `ticks from ${UPDATES} updates`);
  assertDeepEqual(divided.head, whole.head, `the head from ${UPDATES} updates`);
});
