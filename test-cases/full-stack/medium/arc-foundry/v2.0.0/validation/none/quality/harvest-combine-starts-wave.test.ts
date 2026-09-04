// quality/harvest-combine-starts-wave — a fold that eats a candidate is the harvest.
//
// specs/scrap-press.md fixes both halves. A combine whose ingredients include "At
// least one candidate" is "The level's harvest", which "Resolves, then starts the
// wave"; and committing a harvest resolves in a fixed order: "The harvest resolves
// into one permanent structure. Every remaining candidate hardens into a blocker
// for the rest of the run. The wave begins." specs/campaign.md adds that the build
// phase "ends when the player commits the level's harvest" and "That harvest
// launches the wave", and that the first harvest launches wave `1`.
//
// The yard is posed with exactly what the rule needs to be visible: the standing
// component the fold is initiated from, the matching candidate the fold consumes,
// and one unrelated candidate that is not part of the fold and must therefore
// harden. The ingredients are named explicitly, so which two pieces fold is not
// what this check is deciding.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  standCandidate,
  standComponent,
  type Harness,
} from "../harness";
import { anchored } from "./anchors";

const INITIATOR = { col: 8, row: 10 };
const INGREDIENT = { col: 12, row: 10 };
const BYSTANDER = { col: 16, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resolves the fold, hardens the other candidate and begins wave 1", async () => {
  await openYard(h);
  const initiator = await standComponent(
    h,
    "capacitor",
    1,
    INITIATOR.col,
    INITIATOR.row,
  );
  const ingredient = await standCandidate(
    h,
    "capacitor",
    1,
    INGREDIENT.col,
    INGREDIENT.row,
  );
  await standCandidate(h, "coil", 3, BYSTANDER.col, BYSTANDER.row);

  const before = await h.snapshot();
  assertEqual(before.phase, "build", "the phase the harvest is committed from");
  assertEqual(before.wave, 0, "the wave counter before the first harvest");

  await h.debug.select(initiator);
  await h.debug.addToCombineSet(ingredient);

  const after = await captureReplay(h, "harvest", async () => {
    await h.debug.combine(initiator);
    await h.advanceSeconds(1);
    return h.snapshot();
  });

  // 1. The harvest resolved into one permanent structure, at the initiator.
  assertEqual(
    anchored(after, INITIATOR).kind,
    "component",
    "the harvest's result is permanent",
  );
  assertEqual(
    anchored(after, INITIATOR).quality,
    2,
    "the fold's result, one tier up",
  );
  assertEqual(
    anchored(after, INGREDIENT).kind,
    "blocker",
    "the consumed candidate's footprint",
  );
  // 2. Every remaining candidate hardened.
  assertEqual(
    anchored(after, BYSTANDER).kind,
    "blocker",
    "the candidate that was not an ingredient, hardened by the harvest",
  );
  // 3. The wave began.
  assertEqual(after.phase, "wave", "the phase after a harvest combine");
  assertEqual(after.wave, 1, "the wave the first harvest launches");
});
