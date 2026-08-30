// Arc Foundry — effects/systems-present: the twelve produced particle systems are
// on disk and parse as authored systems.
//
// THE REQUIREMENT, from `specs/assets.md`: "Produce these twelve, each at
// `assets/fx/<effect>.json`", followed by the table naming build, combine, bolt,
// chain, spray, ring, impact, death, leak, slow, burn and aura; and "Author each
// with `particle-2d`, whose emit step writes the `system.json` that is the asset."
//
// WHAT IS ASSERTED. That each of the twelve files is on disk, parses, and carries
// at least one emitter. An emitter is what makes a system a system: a document
// with none emits no particle however it is played, so it is a file at the right
// path rather than the asset the specification asked for. Nothing else about the
// document is asserted here — how each is authored is
// `effects/systems-distinct`'s, what colour each carries is
// `effects/status-colors-distinct`'s, and whether the build actually plays them is
// the fourteen points that drive the yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  type Harness,
} from "../harness";
import { tileCenter } from "../constants";
import { evidence } from "./region";
import { EFFECTS, fileOf, missing, readSystem } from "./systems";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("produces all twelve systems, each carrying an emitter", async () => {
  await evidence(h, "fx", async () => {
    // A yard with a structure firing on a unit, so the still shows the effects
    // playing rather than an empty floor.
    await openYard(h, { wave: 1 });
    await standComponent(h, "capacitor", 3, 20, 14);
    await parkUnit(h, "slug", tileCenter(25, 15));
    await h.advanceSeconds(1);
  });

  assertDeepEqual(
    missing(),
    [],
    "assets/fx/<effect>.json on disk for all twelve named effects " +
      "(specs/assets.md)",
  );

  const empty = EFFECTS.filter(
    (effect) => readSystem(effect).emitters.length === 0,
  ).map(fileOf);
  assertDeepEqual(
    empty,
    [],
    "each produced system to carry at least one emitter, so it can emit a " +
      "particle at all (specs/assets.md)",
  );
});
