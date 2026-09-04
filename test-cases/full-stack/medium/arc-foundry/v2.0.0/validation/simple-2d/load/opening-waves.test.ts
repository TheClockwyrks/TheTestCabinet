// load/opening-waves — waves 1 through 3 carry Motes and Sparks only.
//
// specs/enemies.md, under the rules a wave's composition obeys: "Opening waves —
// Waves `1` through `3` carry Motes and Sparks only." The roster holds six
// types, so the rule bars four of them from the run's first three waves: the
// Slug, the Cluster, the Filament and the Dynamo.
//
// Each of the three waves is composed and launched by the game itself and every
// unit it releases is read back by type. The check names the type it found, so a
// build that opens with Clusters fails with the wave and the type it broke on
// rather than with a count.
//
// The neighbouring rules are their own checks: when Clusters and Slugs may first
// arrive is `cluster-and-slug-late`, the air cadence is `air-cadence`, and the
// milestone Dynamos are `milestone-dynamos`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, type Harness, type SpawnType } from "../harness";
import { collectWave, createWaveHarness, openWave, typesOf } from "./waves";

/** The run this check reads. Every difficulty runs the same opening rule. */
const DIFFICULTY = "easy";

/** The waves the rule names. */
const OPENING = [1, 2, 3];

/** The two types the rule allows. */
const ALLOWED: SpawnType[] = ["mote", "spark"];

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(() => {
  h.dispose();
});

it("releases nothing but Motes and Sparks over the first three waves", async () => {
  for (const wave of OPENING) {
    openWave(h, wave, DIFFICULTY);
    const released =
      wave === 1
        ? await captureReplay(h, "opening", () => collectWave(h, wave))
        : await collectWave(h, wave);

    for (const type of typesOf(released)) {
      assertEqual(
        ALLOWED.includes(type),
        true,
        `wave ${wave} to carry Motes and Sparks only; it released a ${type}`,
      );
    }
  }
});
