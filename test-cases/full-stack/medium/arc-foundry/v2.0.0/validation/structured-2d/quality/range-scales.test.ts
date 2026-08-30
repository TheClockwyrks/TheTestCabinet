// quality/range-scales — range is the base range plus RANGE_PER_TIER per rung.
//
// specs/components.md fixes the rule and writes out the table it produces:
// "Range: `baseRange + RANGE_PER_TIER * (tier - 1)`, where `RANGE_PER_TIER` is
// `8`", so a Capacitor reads `100` through `132` and a Discharge Rig `160` through
// `192`. Every figure here is computed from those two constants rather than
// copied, so a build is held to the rule and to the base stats together.
//
// The seven firing types are stood one type at a time, five tiers of it at once
// and nothing else on the yard. An aura changes damage alone and never range
// (specs/components.md), and no Regulator is ever standing here in any case. The
// Regulator has no range row of its own — "its reach is its aura radius" — so it
// is not among the types read.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  componentRange,
  createHarness,
  emptyYard,
  FIRING_TYPES,
  openYard,
  standComponent,
  structureById,
  TIERS,
  type Harness,
} from "../harness";

/** One anchor per tier, each footprint two tiles clear of the next. */
const ANCHORS = [8, 12, 16, 20, 24].map((col) => ({ col, row: 10 }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports baseRange + 8 per tier at every tier of every firing type", async () => {
  openYard(h);

  for (const type of FIRING_TYPES) {
    emptyYard(h);
    const ids: number[] = [];
    for (const [index, tier] of TIERS.entries()) {
      const anchor = ANCHORS[index]!;
      ids.push(standComponent(h, type, tier, anchor.col, anchor.row));
    }

    const yard = h.snapshot();
    for (const [index, tier] of TIERS.entries()) {
      assertCloseTo(
        structureById(yard, ids[index]!).range,
        componentRange(type, tier),
        6,
        `the ${type}'s range at tier ${tier} (specs/components.md)`,
      );
    }
  }

  await h.advance(1);
  captureStill(h, "ladder");
});
