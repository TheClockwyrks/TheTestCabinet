// abilities/arcnode-splash-radius — the discharge covers its radius and stops there.
//
// specs/components.md fixes the splash: "The Arc-Node's projectile discharges at
// its impact point, dealing the shot's full damage to every unit, ground or
// flying, whose position lies within the splash radius of that point", and
// `ARCNODE_SPLASH` gives that radius per tier, `42` at Scrap rising `5` a tier to
// `62`.
//
// Three units stand on one line at every tier: the one the shot is aimed at, one
// well inside the radius of where it will land, and one well outside it. The two
// companions stand FURTHER from the structure than its own radius reaches, so
// neither of them can be the unit the shot was aimed at and the impact point is
// never in doubt. Their margins are twelve units either side of the radius, which
// is twice `PROJECTILE_HIT_R` — the impact lands within `6` of the target's
// position, so twelve of clearance keeps each companion unambiguously on its own
// side of the boundary whatever the build's arrival tolerance did.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  ARCNODE_SPLASH,
  componentDamage,
  componentRange,
  PROJECTILE_HIT_R,
  TIERS,
} from "../constants";
import {
  captureReplay,
  createHarness,
  emptyYard,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
} from "../harness";
import { awaitImpact } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** How far out the aimed-at unit stands, as a share of the tier's radius. */
const AIM = 0.9;

/** The clearance either side of the boundary: twice the arrival tolerance. */
const MARGIN = 2 * PROJECTILE_HIT_R;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes the full shot off a unit inside the radius and nothing off one outside", async () => {
  openYard(h, { wave: 5 });

  await captureReplay(h, "splash", async () => {
    for (const tier of TIERS) {
      emptyYard(h);
      const id = standComponent(h, "arcnode", tier, ANCHOR.col, ANCHOR.row);
      const structure = structureById(h.snapshot(), id);

      const radius = ARCNODE_SPLASH[tier - 1]!;
      const aimed = componentRange("arcnode", tier) * AIM;
      const target = parkUnit(h, "dynamo", {
        x: structure.cx + aimed,
        y: structure.cy,
      });
      const inside = parkUnit(h, "dynamo", {
        x: structure.cx + aimed + (radius - MARGIN),
        y: structure.cy,
      });
      const outside = parkUnit(h, "dynamo", {
        x: structure.cx + aimed + (radius + MARGIN),
        y: structure.cy,
      });

      const before = h.snapshot();
      const after = await awaitImpact(h, target);

      assertGreaterThan(
        unitById(before, target).hp - unitById(after, target).hp,
        0,
        `the health the aimed-at unit lost at tier ${tier}`,
      );
      assertCloseTo(
        unitById(before, inside).hp - unitById(after, inside).hp,
        componentDamage("arcnode", tier),
        6,
        `the health a unit ${radius - MARGIN} from the impact lost at tier ` +
          `${tier}, whose splash radius is ${radius} (specs/components.md)`,
      );
      assertEqual(
        unitById(before, outside).hp - unitById(after, outside).hp,
        0,
        `the health a unit ${radius + MARGIN} from the impact lost at tier ` +
          `${tier}, whose splash radius is ${radius}`,
      );
    }
  });
});
