// modes/standard-restores-the-save — continuing from a Standard death puts the
// expedition back as it was saved.
//
// specs/modes.md, Standard: "Restoring puts the player back on the surface with
// the saved mine, Credits, upgrade tiers, installed components, cargo, materials,
// fuel and hull." So `CONTINUE FROM SAVE` is a restore rather than a retry: every
// holding comes back at the value the pad wrote, not at the value the expedition
// held when it died and not at a fresh expedition's.
//
// THE EXPEDITION IS DIRTIED BETWEEN THE SAVE AND THE DEATH, deliberately. Each
// holding is posed once before the save and again, to a different value, after
// it, so a build that ignored the save and simply carried on reads back the
// dirtied value, and a build that started fresh reads back the default. Only a
// real restore reads back the saved one.
//
// ISOLATION. One Standard expedition on a generated mine with the slot cleared
// first, so the mine that comes back is the one that was saved. The death is a
// hull standing at `0`, and the choice is the Game Over screen's first entry,
// which specs/ui.md fixes as `CONTINUE FROM SAVE` while a Standard save exists.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENT_IDS, TRACKS } from "../constants";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  stageCargo,
  stageTiers,
  type Harness,
  type Ore,
  type TileKind,
  type UpgradeTrack,
} from "../harness";
import {
  SURFACE_ROW,
  bankSave,
  driveDeath,
  openGeneratedAtCamp,
} from "../save/expedition";

/** What the pad wrote. */
const SAVED = {
  credits: 3300,
  tiers: {
    fuel: 2,
    drill: 3,
    cargo: 2,
    hull: 4,
    jetpack: 3,
    radiator: 2,
    scanner: 2,
  } as Record<UpgradeTrack, number>,
  components: 3,
  cargo: { marlite: 5, voltite: 2 } as Partial<Record<Ore, number>>,
  materials: { resonite: 2, cryenite: 1 },
  fuel: 61,
  hull: 173,
};

/** What the expedition held when it died, none of which may come back. */
const DIRTIED = {
  credits: 12,
  cargo: { ferron: 9 } as Partial<Record<Ore, number>>,
  materials: { resonite: 0, cryenite: 0 },
  fuel: 4,
};

/** A cell posed into the mine before the save, which the restore must return. */
const MARK_COL = 7;
const MARK_ROW = 44;
const MARK_KIND: TileKind = "stone";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("restores every saved holding and the saved mine on CONTINUE FROM SAVE", async () => {
  await openGeneratedAtCamp(h, { mode: "standard" });

  stageTiers(h, SAVED.tiers);
  h.debug.setCredits(SAVED.credits);
  h.debug.setRocketInstalled(SAVED.components);
  stageCargo(h, SAVED.cargo);
  h.debug.setMaterial("resonite", SAVED.materials.resonite);
  h.debug.setMaterial("cryenite", SAVED.materials.cryenite);
  h.debug.setFuel(SAVED.fuel);
  h.debug.setHull(SAVED.hull);
  h.debug.setTile(MARK_COL, MARK_ROW, MARK_KIND);
  bankSave(h);

  // Everything moved on after the save, so nothing below can read back right by
  // having been left alone.
  h.debug.setCredits(DIRTIED.credits);
  stageCargo(h, DIRTIED.cargo);
  h.debug.setMaterial("resonite", DIRTIED.materials.resonite);
  h.debug.setMaterial("cryenite", DIRTIED.materials.cryenite);
  h.debug.setFuel(DIRTIED.fuel);
  h.debug.setTile(MARK_COL, MARK_ROW, "tunnel");

  const over = await driveDeath(h, "hull-destroyed");
  assertEqual(
    over.hasSave,
    true,
    "specs/modes.md: a Standard death leaves the save to be restored",
  );

  h.debug.setMenuIndex(0);
  await h.tap(ACTION_KEY.activate);
  await h.advance(1);

  const restored = h.snapshot();
  captureStill(h, "restored");
  assertEqual(
    restored.screen,
    "in-mine",
    "specs/modes.md: CONTINUE FROM SAVE restores the save into the mine",
  );
  assertLessThanOrEqual(
    restored.miner.row,
    SURFACE_ROW,
    "specs/modes.md: restoring puts the player back on the surface",
  );
  assertEqual(
    restored.credits,
    SAVED.credits,
    "specs/modes.md: the saved Credits come back",
  );
  for (const track of TRACKS) {
    assertEqual(
      restored.tiers[track],
      SAVED.tiers[track],
      `specs/modes.md: the saved ${track} tier comes back`,
    );
  }
  assertDeepEqual(
    restored.rocket.installed,
    ROCKET_COMPONENT_IDS.slice(0, SAVED.components),
    "specs/modes.md: the saved installed components come back",
  );
  assertDeepEqual(
    restored.cargo.ore,
    SAVED.cargo,
    "specs/modes.md: the saved cargo comes back",
  );
  assertEqual(
    restored.satchel.resonite,
    SAVED.materials.resonite,
    "specs/modes.md: the saved Resonite comes back",
  );
  assertEqual(
    restored.satchel.cryenite,
    SAVED.materials.cryenite,
    "specs/modes.md: the saved Cryenite comes back",
  );
  assertEqual(
    restored.miner.fuel,
    SAVED.fuel,
    "specs/modes.md: the saved fuel comes back",
  );
  assertEqual(
    restored.miner.hull,
    SAVED.hull,
    "specs/modes.md: the saved hull comes back",
  );
  assertEqual(
    h.tileAt(MARK_COL, MARK_ROW).kind,
    MARK_KIND,
    "specs/modes.md: the saved mine comes back",
  );
});
