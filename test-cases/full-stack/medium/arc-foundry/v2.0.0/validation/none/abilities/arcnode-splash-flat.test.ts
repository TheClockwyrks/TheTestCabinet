// abilities/arcnode-splash-flat — every unit inside the radius loses the same.
//
// specs/components.md fixes it in one sentence: "Damage is flat inside the radius,
// with no falloff." It is its own point because a build that scales the splash
// with distance covers the right radius and still plays differently: a pack of
// units clustered at the edge of a discharge takes a fraction of what the table
// says it should.
//
// Two companions stand at very different distances from where the shot will land —
// one just past the aimed-at unit, one nearly at the edge of the radius — and both
// stand further from the structure than its own radius reaches, so neither can be
// the unit the shot was aimed at. What is read is that the two lost the same
// health as each other and that each lost the shot's whole damage.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { ARCNODE_SPLASH, componentDamage } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  unitById,
  type Harness,
} from "../harness";
import { awaitImpact } from "./impact";

const ANCHOR = { col: 10, row: 10 };

/** The tier this is read at: a `112` radius and a `52` splash. */
const TIER = 3;

/** Where the shot is aimed, inside the tier's radius. */
const AIM = 100;

/** The two distances from the impact point, both well inside the splash. */
const NEAR = 20;
const FAR = 44;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the same health off a unit near the impact and one near the edge", async () => {
  await openYard(h, { wave: 1 });
  const id = await standComponent(h, "arcnode", TIER, ANCHOR.col, ANCHOR.row);
  const structure = structureById(await h.snapshot(), id);

  // Both companions stand beyond the structure's own radius, so the shot can only
  // be aimed at the first unit and the impact point is where it stands.
  const target = await parkUnit(h, "dynamo", {
    x: structure.cx + AIM,
    y: structure.cy,
  });
  const near = await parkUnit(h, "dynamo", {
    x: structure.cx + AIM + NEAR,
    y: structure.cy,
  });
  const far = await parkUnit(h, "dynamo", {
    x: structure.cx + AIM + FAR,
    y: structure.cy,
  });

  const before = await h.snapshot();
  const after = await captureReplay(h, "flat", () => awaitImpact(h, target));

  const shot = componentDamage("arcnode", TIER);
  const nearLost = unitById(before, near).hp - unitById(after, near).hp;
  const farLost = unitById(before, far).hp - unitById(after, far).hp;
  assertCloseTo(
    nearLost,
    shot,
    6,
    `the health a unit ${NEAR} from the impact lost, inside the ` +
      `${ARCNODE_SPLASH[TIER - 1]!} splash radius (specs/components.md)`,
  );
  assertCloseTo(
    farLost,
    shot,
    6,
    `the health a unit ${FAR} from the impact lost, still inside that radius`,
  );
  assertCloseTo(
    farLost,
    nearLost,
    6,
    `the health lost ${FAR} from the impact against the health lost ${NEAR} ` +
      `from it: the splash is flat inside the radius`,
  );
});
