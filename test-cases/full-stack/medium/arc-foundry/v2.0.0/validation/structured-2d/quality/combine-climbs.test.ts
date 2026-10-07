// quality/combine-climbs — a matching pair folds into one structure a tier higher.
//
// specs/scrap-press.md fixes the quality-combine exactly: "Two base structures of
// the same type and the same quality fold into one structure of that type one tier
// higher", two Scrap producing one Tuned. It also fixes what the fold leaves
// behind, because both kinds of combine are wall-neutral: "every footprint a
// combine consumes hardens into a blocker rather than being freed", and "the
// result lands at the footprint of the piece the combine was initiated from".
//
// The yard holds exactly the pair the requirement is about and nothing else: two
// Scrap Capacitors, both standing components, so the fold consumes no candidate
// and the phase is no part of what is read. The tier the fold produced is read as
// the tier itself and as the two figures specs/components.md scales from it, so a
// build that labels the result Tuned without scaling it fails here rather than
// passing on the label.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  standComponent,
} from "../harness";
import { anchored } from "./anchors";
import { componentDamage, componentRange } from "../constants";

/** The initiator's anchor, and the partner's, clear of it by two footprints. */
const INITIATOR = { col: 8, row: 10 };
const PARTNER = { col: 12, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("folds two Scrap Capacitors into one Tuned Capacitor", async () => {
  openYard(h);
  const initiator = standComponent(
    h,
    "capacitor",
    1,
    INITIATOR.col,
    INITIATOR.row,
  );
  standComponent(h, "capacitor", 1, PARTNER.col, PARTNER.row);

  h.debug.combine(initiator);
  await h.advance(1);
  captureStill(h, "fold");

  const after = h.snapshot();
  // Two pieces went in; one base structure and one wall came out.
  assertLength(after.structures, 2);
  assertLength(
    after.structures.filter((s) => s.kind === "component"),
    1,
    "one base structure left standing after the fold (specs/scrap-press.md)",
  );
  assertLength(
    after.structures.filter((s) => s.kind === "blocker"),
    1,
    "one consumed footprint hardened into a blocker (specs/scrap-press.md)",
  );

  const result = anchored(after, INITIATOR);
  assertEqual(result.kind, "component");
  assertEqual(result.type, "capacitor", "the fold keeps the type");
  assertEqual(result.quality, 2, "two Scrap fold into one Tuned");
  assertCloseTo(
    result.damage,
    componentDamage("capacitor", 2),
    6,
    "the Tuned tier's damage (specs/components.md)",
  );
  assertCloseTo(
    result.range,
    componentRange("capacitor", 2),
    6,
    "the Tuned tier's range (specs/components.md)",
  );

  const consumed = anchored(after, PARTNER);
  assertEqual(
    consumed.kind,
    "blocker",
    "the partner's footprint after the fold (specs/scrap-press.md)",
  );
  assertEqual(consumed.type, null);
  assertEqual(consumed.quality, null);
});
