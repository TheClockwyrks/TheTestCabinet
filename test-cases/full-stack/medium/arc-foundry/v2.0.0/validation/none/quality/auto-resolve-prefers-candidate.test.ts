// quality/auto-resolve-prefers-candidate — the fold eats the candidate first.
//
// specs/scrap-press.md fixes what the game picks when the player has named no
// ingredients: "With no explicit set, the game resolves the ingredients itself
// from the yard, and it consumes a candidate in preference to a standing structure
// wherever either would satisfy the fold."
//
// So the yard is posed with the ambiguity and nothing else: the initiator, a
// standing Scrap Capacitor; a second standing Scrap Capacitor; and a Scrap
// Capacitor candidate rolled through the real press. Any of the two could satisfy
// the initiator's fold, and the preference decides which does. The explicit set is
// emptied first, so the choice the check reads is the game's own.
//
// What is read is which footprint survived: the standing partner still stands, and
// the candidate's footprint has hardened into a blocker.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  standComponent,
  type Harness,
} from "../harness";
import { anchored } from "./anchors";

const INITIATOR = { col: 8, row: 10 };
const STANDING = { col: 12, row: 10 };
const CANDIDATE = { col: 16, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes the candidate and leaves the standing component in place", async () => {
  await openYard(h);
  const initiator = await standComponent(
    h,
    "capacitor",
    1,
    INITIATOR.col,
    INITIATOR.row,
  );
  await standComponent(h, "capacitor", 1, STANDING.col, STANDING.row);
  await standCandidate(h, "capacitor", 1, CANDIDATE.col, CANDIDATE.row);

  // No explicit set and no selection: the ingredients are the game's to resolve.
  await h.debug.clearSelection();
  await h.debug.clearCombineSet();
  const posed = await h.snapshot();
  assertLength(posed.combineSet, 0, "no explicit combine set before the fold");

  await h.debug.combine(initiator);
  await h.advance(1);
  await captureStill(h, "resolve");

  const after = await h.snapshot();
  assertEqual(
    anchored(after, INITIATOR).quality,
    2,
    "the fold landed on the initiator, one tier up",
  );
  assertEqual(
    anchored(after, CANDIDATE).kind,
    "blocker",
    "the candidate's footprint, consumed in preference to the standing component",
  );
  assertEqual(
    anchored(after, STANDING).kind,
    "component",
    "the standing component's footprint, left in place",
  );
  assertEqual(
    anchored(after, STANDING).quality,
    1,
    "the standing component untouched at the tier it was stood at",
  );
});
