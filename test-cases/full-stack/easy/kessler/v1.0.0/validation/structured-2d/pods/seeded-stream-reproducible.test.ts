// pods/seeded-stream-reproducible — the same seed and the same destructions
// shed the same pods, of the same kinds, in the same order.
//
// specs/pods.md: "The game keeps one random stream for the whole session: a
// mulberry32 generator seeded with the session's seed. ... so the same seed and
// the same play shed the same pods in the same order." The reading is a
// comparison between two sessions of one build, reset(seed) with the same
// seed and played identically, so any conformant stream implementation passes;
// the seed is chosen (from the specification's own generator) so the six draws
// shed more than once, keeping the comparison from passing vacuously.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DRAW. Each destruction is staged on
// a frozen ring 1 through the shared draw helper, the deflector is parked away
// from every slot used, and each shed is read and cleared before the next draw.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { AWAY_ANGLE, shedOf } from "./draw";
import { podSequence } from "./rng";

/** Chosen so six draws shed at least twice (mulberry32(3) sheds three times). */
const SEED = 3;
/** Ring-1 slots destroyed, in order: one slot per draw. */
const SLOTS = [0, 1, 2, 3, 4, 5];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** One session: reset(SEED), six identical destructions, sheds read. */
async function playSession(h2: Harness): Promise<(string | null)[]> {
  isolate(h2, SEED);
  h2.debug.setPodSpawn(true);
  h2.debug.setPaddleAngle(AWAY_ANGLE);
  const sheds: (string | null)[] = [];
  for (const slot of SLOTS) sheds.push(await shedOf(h2, slot));
  return sheds;
}

it("replays the same sheds for the same seed and the same play", async () => {
  const first = await captureReplay(h, "seeded-run", () => playSession(h));
  const second = await playSession(h);

  assertDeepEqual(
    second,
    first,
    "the second seeded session's sheds, against the first's",
  );
  // Vacuity guard, from the specification's own generator: mulberry32(3) sheds
  // within six draws, so two all-empty runs cannot pass this item quietly.
  assertTrue(
    podSequence(SEED, SLOTS.length).some((kind) => kind !== null) &&
      first.some((kind) => kind !== null),
    "six seeded draws shed at least one pod",
  );
});
