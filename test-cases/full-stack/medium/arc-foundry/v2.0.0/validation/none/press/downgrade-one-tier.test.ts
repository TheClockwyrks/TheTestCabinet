// press/downgrade-one-tier — DOWNGRADE harvests the candidate one quality tier
// lower, at the same type, and starts the wave the same way KEEP does.
//
// WHY A PLAYER WOULD EVER WANT IT. `specs/combinations.md` fixes the recipes at
// exact `(type, quality)` pairs, so a Charged Rectifier is worth less than a
// Tuned one to a player who needs a Tuned one — and DOWNGRADE is the only way
// down the ladder. It is a harvest like any other, which means it is also the
// commitment that ends the build phase.
//
// SO THREE THINGS ARE READ: the tier fell by exactly one, the type did not move,
// and the wave started. A build that drops two tiers, or that changes the type
// on the way, breaks a recipe the player was assembling; one that leaves the
// phase running has a level that yields two harvests.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  structureById,
  type Harness,
} from "../harness";

/** The roll that is downgraded, and where it lands. */
const ROLLS = { type: "coil", quality: 3 } as const;
const AT = { col: 20, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("harvests one tier lower, at the same type, and launches the wave", async () => {
  await openYard(h);
  const opened = await h.snapshot();
  assertEqual(opened.phase, "build", "the phase the run opens on");
  assertEqual(opened.wave, 0, "the wave counter before the first harvest");

  const candidate = await standCandidate(
    h,
    ROLLS.type,
    ROLLS.quality,
    AT.col,
    AT.row,
  );
  await h.debug.select(candidate);
  await h.debug.downgrade(candidate);

  const harvested = await h.snapshot();
  await captureStill(h, "downgraded");

  const component = structureById(harvested, candidate);
  assertEqual(component.kind, "component", "what DOWNGRADE leaves standing");
  assertEqual(
    component.type,
    ROLLS.type,
    "the type a downgraded component carries, which the harvest does not move",
  );
  assertEqual(
    component.quality,
    ROLLS.quality - 1,
    `the quality a downgraded component carries, one tier below the ` +
      `${ROLLS.quality} it rolled`,
  );

  // It is a harvest, so it is what starts the wave.
  assertEqual(
    harvested.phase,
    "wave",
    "the phase a downgrade leaves the run in",
  );
  assertEqual(
    harvested.wave,
    opened.wave + 1,
    "the wave the downgrade launched",
  );
});
