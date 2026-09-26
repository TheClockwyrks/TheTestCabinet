// targeting/default-first — a structure lands set to `first`.
//
// specs/components.md fixes the default: "Every firing structure carries a
// targeting priority, chosen by the player and changed at any time.
// `TARGETING_PRIORITIES` holds the five, and every firing structure defaults to
// `first`." So a player who never touches the control gets a yard of towers all
// shooting the leading unit, and a build that defaults to anything else plays a
// different opening.
//
// All three ways a firing structure comes to stand on the yard are read, because a
// build can easily set the default on one path and forget another: a component
// stood directly, a combination tower, and a candidate harvested into a component
// through the level's own KEEP. Nothing here fires: the priority is read off the
// structure the moment it lands, before any unit exists to shoot at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DEFAULT_TARGETING } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCandidate,
  standCombo,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

const COMPONENT = { col: 8, row: 10 };
const TOWER = { col: 20, row: 10 };
const CANDIDATE = { col: 14, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports first on a component, a tower and a harvested candidate", async () => {
  openYard(h);

  const component = standComponent(
    h,
    "capacitor",
    3,
    COMPONENT.col,
    COMPONENT.row,
  );
  const tower = standCombo(h, "forkarray", TOWER.col, TOWER.row);
  const candidate = standCandidate(
    h,
    "discharge",
    2,
    CANDIDATE.col,
    CANDIDATE.row,
  );
  // A candidate does not fire and has no priority to report; harvesting it is
  // what makes it a firing structure (specs/scrap-press.md).
  h.debug.keep(candidate);

  await h.advance(1);
  captureStill(h, "default");

  const yard = h.snapshot();
  assertEqual(
    structureById(yard, component).targeting,
    DEFAULT_TARGETING,
    "the priority a component reports the moment it lands",
  );
  assertEqual(
    structureById(yard, tower).targeting,
    DEFAULT_TARGETING,
    "the priority a combination tower reports the moment it lands",
  );
  assertEqual(
    structureById(yard, candidate).targeting,
    DEFAULT_TARGETING,
    "the priority a harvested candidate reports the moment it is kept",
  );
});
