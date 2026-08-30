// load/cluster-and-slug-late — neither Clusters nor Slugs before wave 5.
//
// specs/enemies.md, under the rules a wave's composition obeys: "Cluster and
// Slug — Neither appears before wave `5`." The two are the answers to splash and
// chain and to concentrated single hits, so a run that opens with them asks for
// components the press has had no chance to roll.
//
// The rule bars them from waves `1` through `4`, and those four waves are
// composed and launched by the game itself and read back unit by unit. Waves `1`
// through `3` are held to a stricter rule of their own — Motes and Sparks alone —
// which is the sibling `opening-waves` check, so what this one adds is wave `4`,
// the first wave the roster opens up on and the last one these two are barred
// from.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, type Harness } from "../harness";
import { collectWave, countOf, createWaveHarness, openWave } from "./waves";

const DIFFICULTY = "easy";

/** The waves the rule bars them from. */
const EARLY = [1, 2, 3, 4];

/** The last wave before either may arrive, kept as the clip. */
const EVIDENCE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createWaveHarness();
});

afterEach(() => {
  h.dispose();
});

it("releases no Cluster and no Slug on waves 1 through 4", async () => {
  for (const wave of EARLY) {
    openWave(h, wave, DIFFICULTY);
    const released =
      wave === EVIDENCE
        ? await captureReplay(h, "early", () => collectWave(h, wave))
        : await collectWave(h, wave);

    assertEqual(
      countOf(released, "cluster"),
      0,
      `wave ${wave} is before wave 5, so it carries no Cluster`,
    );
    assertEqual(
      countOf(released, "slug"),
      0,
      `wave ${wave} is before wave 5, so it carries no Slug`,
    );
  }
});
