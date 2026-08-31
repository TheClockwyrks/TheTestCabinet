// pods/default-seed-one — a fresh session's pod sequence is the DEFAULT_SEED
// (1) sequence.
//
// specs/pods.md: "A fresh session seeds it with DEFAULT_SEED (1), and pod
// draws are the only thing that consumes it." The reading is the item's own
// comparison: a session reset with NO seed, played through three destructions,
// sheds exactly what a reset({ seed: 1 }) session played the same way sheds.
// The seed-1 stream sheds on its second draw (mulberry32(1): 0.6271 then
// 0.0027), so the comparison cannot pass on two empty runs.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DRAW, staged by the shared draw
// helper on a frozen ring 1 with the deflector parked away.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { AWAY_ANGLE, shedOf } from "./draw";
import { DEFAULT_SEED } from "../surface";
import { podSequence } from "./rng";

/** Draws enough to include seed 1's first shed (its second draw). */
const SLOTS = [0, 1, 2];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Three identical destructions; `seed` undefined is the fresh session. */
async function playSession(
  h2: Harness,
  seed: number | undefined,
): Promise<(string | null)[]> {
  isolate(h2, seed);
  h2.debug.setPodSpawn(true);
  h2.debug.setPaddleAngle(AWAY_ANGLE);
  const sheds: (string | null)[] = [];
  for (const slot of SLOTS) sheds.push(await shedOf(h2, slot));
  return sheds;
}

it("sheds as a seed-1 session sheds when reset names no seed", async () => {
  const fresh = await captureReplay(h, "default-run", () =>
    playSession(h, undefined),
  );
  const seeded = await playSession(h, DEFAULT_SEED);

  assertDeepEqual(
    fresh,
    seeded,
    "the fresh session's sheds, against reset({ seed: 1 })",
  );
  // Vacuity guard: the specification's own seed-1 stream sheds within three
  // draws, so two empty runs cannot pass this item quietly.
  assertTrue(
    podSequence(DEFAULT_SEED, SLOTS.length).some((kind) => kind !== null) &&
      fresh.some((kind) => kind !== null),
    "the seed-1 stream sheds within three draws",
  );
});
