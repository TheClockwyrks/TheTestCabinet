// load/opening-waves — waves 1 through 3 carry Motes and Sparks only.
//
// specs/enemies.md, under the rules a wave's composition obeys: "Opening waves —
// Waves `1` through `3` carry Motes and Sparks only." The roster holds six
// types, so the rule bars four of them from the run's first three waves: the
// Slug, the Cluster, the Filament and the Dynamo.
//
// Each of the three waves is composed and launched by the game itself and every
// type its schedule holds is read back. The check names the type it found, so a
// build that opens with Clusters fails with the wave and the type it broke on
// rather than with a count.
//
// The neighbouring rules are their own checks: when Clusters and Slugs may first
// arrive is `cluster-and-slug-late`, the air cadence is `air-cadence`, and the
// milestone Dynamos are `milestone-dynamos`.
//
// WHAT IS READ is `waveCount` over the six roster types on the frame the harvest
// launched the wave: the live wave's own schedule, which is the array the spawner
// is working through (specs/instrumentation.md). That the schedule and what the
// spawner actually releases are the same thing is
// `instrumentation/wave-count-matches-the-spawner`'s requirement, decided once
// there over a wave driven to its clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import type { Harness } from "../harness";
import {
  composedWave,
  composedWaveOnCamera,
  createWaveHarness,
  typesIn,
} from "./waves";
import type { LoadType } from "../constants";

/** The run this check reads. Every difficulty runs the same opening rule. */
const DIFFICULTY = "easy";

/** The waves the rule names. */
const OPENING = [1, 2, 3];

/** The two types the rule allows. */
const ALLOWED: LoadType[] = ["mote", "spark"];

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(() => {
  h.dispose();
});

it("releases nothing but Motes and Sparks over the first three waves", async () => {
  for (const wave of OPENING) {
    const counts =
      wave === 1
        ? await composedWaveOnCamera(h, wave, DIFFICULTY, "opening")
        : composedWave(h, wave, DIFFICULTY);

    for (const type of typesIn(counts)) {
      assertEqual(
        ALLOWED.includes(type),
        true,
        `wave ${wave} to carry Motes and Sparks only; it carries a ${type}`,
      );
    }
  }
});
