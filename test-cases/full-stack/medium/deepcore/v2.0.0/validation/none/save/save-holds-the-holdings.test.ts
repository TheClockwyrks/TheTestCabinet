// save/save-holds-the-holdings — the save carries every holding the expedition
// has accumulated.
//
// specs/gameplay.md: "A save holds the generated mine and its world size, the
// mode, banked Credits, every upgrade tier, the installed rocket components, the
// held field-supply counts, the cargo, the satchel's materials, and the miner's
// fuel and hull." The mine and the size are `save/save-holds-the-mine` and
// `world-size/size-carried-in-the-save`; this check decides the eight holdings.
//
// EVERY VALUE IS DISTINCTIVE. Each is posed away from both the value a fresh
// expedition opens at and the value a `reset` restores, so a build that dropped a
// field from the save and rebuilt it from the defaults reads back wrong rather
// than reading back right by coincidence. The tiers are posed first, because
// specs/instrumentation.md has `setTier` clamp the fuel and hull held to the new
// maxima.
//
// ISOLATION. One expedition on an empty mine with the slot cleared first, the
// miner standing at the camp where saving is allowed, no Core Sample live, and
// nothing driven: the holdings are posed, the save is written through the control
// that stands for the Save Pad, and the restore is the title's `CONTINUE`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ITEM_IDS,
  ROCKET_COMPONENT_IDS,
  UPGRADE_TRACKS,
  type ItemId,
  type Ore,
  type UpgradeTrack,
} from "../constants";
import {
  captureStill,
  createHarness,
  stageCargo,
  stageItems,
  stageTiers,
  type Harness,
} from "../harness";
import { bankSave, continueFromTitle, openAtCamp } from "./expedition";

/** The eight holdings, each posed away from the value a fresh expedition opens at. */
const CREDITS = 7654;
const TIERS: Record<UpgradeTrack, number> = {
  fuel: 3,
  drill: 4,
  cargo: 2,
  hull: 5,
  jetpack: 2,
  radiator: 4,
  scanner: 3,
};
const COMPONENTS = 2;
const ITEMS: Record<ItemId, number> = {
  dynamite: 3,
  "plastic-explosives": 1,
  "quantum-teleporter": 4,
  "matter-transmitter": 2,
  nanobots: 5,
  "emergency-fuel": 6,
};
const CARGO: Partial<Record<Ore, number>> = {
  ferron: 4,
  cobaltine: 2,
  roselite: 1,
};
const MATERIALS = { resonite: 1, cryenite: 2 };
const FUEL = 137;
const HULL = 211;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the Credits, tiers, components, supplies, cargo, materials, fuel and hull", async () => {
  await openAtCamp(h);

  await h.debug.setCredits(CREDITS);
  await stageTiers(h, TIERS);
  await h.debug.setRocketInstalled(COMPONENTS);
  await stageItems(h, ITEMS);
  await stageCargo(h, CARGO);
  await h.debug.setMaterial("resonite", MATERIALS.resonite);
  await h.debug.setMaterial("cryenite", MATERIALS.cryenite);
  await h.debug.setFuel(FUEL);
  await h.debug.setHull(HULL);

  const posed = await h.snapshot();
  await bankSave(h);
  await continueFromTitle(h);
  await h.advance(1);

  const restored = await h.snapshot();
  await captureStill(h, "holdings");

  assertEqual(
    restored.credits,
    CREDITS,
    "specs/gameplay.md: the save holds the banked Credits",
  );
  for (const track of UPGRADE_TRACKS) {
    assertEqual(
      restored.tiers[track],
      TIERS[track],
      `specs/gameplay.md: the save holds the ${track} tier`,
    );
  }
  assertDeepEqual(
    restored.rocket.installed,
    ROCKET_COMPONENT_IDS.slice(0, COMPONENTS),
    "specs/gameplay.md: the save holds the installed rocket components",
  );
  for (const item of ITEM_IDS) {
    assertEqual(
      restored.items[item],
      ITEMS[item],
      `specs/gameplay.md: the save holds the ${item} count`,
    );
  }
  assertDeepEqual(
    restored.cargo.ore,
    CARGO,
    "specs/gameplay.md: the save holds the cargo",
  );
  assertEqual(
    restored.satchel.resonite,
    MATERIALS.resonite,
    "specs/gameplay.md: the save holds the satchel's Resonite",
  );
  assertEqual(
    restored.satchel.cryenite,
    MATERIALS.cryenite,
    "specs/gameplay.md: the save holds the satchel's Cryenite",
  );
  assertEqual(
    restored.miner.fuel,
    FUEL,
    "specs/gameplay.md: the save holds the fuel the miner climbed out with",
  );
  assertEqual(
    restored.miner.hull,
    HULL,
    "specs/gameplay.md: the save holds the hull the miner climbed out with",
  );
  // The maxima the posed tiers set, so a build that restored the tiers but not
  // the fuel and hull is caught reading back a full tank instead.
  assertEqual(
    restored.miner.maxFuel,
    posed.miner.maxFuel,
    "specs/upgrades.md: the restored fuel tier sets the same maximum",
  );
  assertEqual(
    restored.miner.maxHull,
    posed.miner.maxHull,
    "specs/upgrades.md: the restored hull tier sets the same maximum",
  );
});
