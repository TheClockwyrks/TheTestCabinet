// Wireworm — instrumentation/reset-seeds-randomness: `reset`'s seed decides the
// randomness a run then draws on.
//
// specs/instrumentation.md: `options.seed`, a number defaulting to `DEFAULT_SEED`
// (`1`), seeds all of the game's randomness, and "given the same seed and the
// same sequence of calls and elapsed game time, the game reaches the same state
// every time". specs/nodes.md names the starting scatter as one of the things
// drawn from that generator, and says outright that "two runs from different
// seeds lay different fields".
//
// THE SCATTER IS WHAT THIS READS, because it is the largest single draw the game
// makes and the only one a run lays before anything else happens: a fresh run's
// field is between `SCATTER_MIN_FRACTION` and `SCATTER_MAX_FRACTION` of the `680`
// tiles rows `1`–`17` hold, which is at least 68 tiles chosen from 680. Two
// independent draws of that size agreeing tile for tile does not happen, so the
// two directions this point asserts — same seed, same field; different seed,
// different field — separate a seeded generator from an unseeded one.
//
// WHY THE MENU IS DRIVEN. The scatter is laid when a RUN starts, and the surface
// carries no operation that starts one: `setLevel` "spawns nothing and clears
// nothing" (specs/instrumentation.md). specs/ui.md gives the one route there is —
// the title's first item, `DESCEND`, taken with `confirm` — so that is the route,
// and `reset` leaves the title's highlight on the first item to be taken.
//
// WHAT IT DOES NOT DECIDE. Nothing about the scatter itself: its rows, its
// density and the charge it is laid at are the `board` group's points. This one
// compares one field against another.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  nodeKeys,
  type Harness,
} from "../harness";

/** The two seeds compared: any two distinct numbers serve. */
const SEED_A = 7;
const SEED_B = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays the same scatter from the same seed and a different one from another", async () => {
  /** Open a run after seeding, and answer the field it laid as a stable key. */
  const scatterFrom = async (seed: number): Promise<string> => {
    h.debug.reset({ seed });
    // `reset` leaves the title's highlight on the first item, `DESCEND`, and
    // `confirm` takes it (specs/ui.md).
    h.debug.setMenuIndex(0);
    await h.tap("Enter");
    const snapshot = h.snapshot();
    assertGreaterThan(
      snapshot.nodes.length,
      0,
      "taking DESCEND from the title must open a run, which lays the starting " +
        "scatter (specs/ui.md, specs/nodes.md)",
    );
    return [...nodeKeys(snapshot)].sort().join(" ");
  };

  const first = await scatterFrom(SEED_A);
  // The scatter seed 7 laid.
  captureStill(h, "scatter");

  const again = await scatterFrom(SEED_A);
  assertEqual(
    again,
    first,
    `two runs opened after reset({ seed: ${String(SEED_A)} }) must lay the ` +
      "identical starting scatter (specs/instrumentation.md)",
  );

  const other = await scatterFrom(SEED_B);
  assertNotEqual(
    other,
    first,
    `a run opened after reset({ seed: ${String(SEED_B)} }) must lay a ` +
      "different scatter from one opened after " +
      `reset({ seed: ${String(SEED_A)} }) (specs/nodes.md)`,
  );
});
