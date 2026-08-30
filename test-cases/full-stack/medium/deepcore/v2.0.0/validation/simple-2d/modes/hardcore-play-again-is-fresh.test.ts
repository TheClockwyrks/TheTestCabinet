// modes/hardcore-play-again-is-fresh — PLAY AGAIN after a Hardcore death starts
// over from nothing.
//
// specs/modes.md, Hardcore: "The Game Over screen offers `PLAY AGAIN`, which
// starts a completely fresh Hardcore expedition at the same world size."
// specs/gameplay.md says what a fresh expedition is: "The miner starts standing on
// the camp ground at `SPAWN_COL`, at tier `1` on every upgrade track, with a full
// fuel tank and a full hull, `0` Credits, an empty cargo bay, an empty satchel, no
// field supplies, and no rocket component installed. The mine is generated fresh
// from the current seed at the chosen size."
//
// SO THE READING IS TWO-SIDED. What must be UNCHANGED — the mode and the world
// size — and what must be BACK AT ITS STARTING VALUE, which is every holding.
// Each of those is posed away from its starting value before the death, so a
// build that carried anything over is caught on the value it carried.
//
// ISOLATION. One Hardcore expedition at a size that is not the session default,
// so "at the same world size" is a real reading rather than a coincidence, on an
// empty mine with the slot cleared first. The death is a hull standing at `0`,
// and the choice is the Game Over screen's first entry, which specs/ui.md fixes
// as `PLAY AGAIN` once the Hardcore death has taken the save.

import { afterEach, beforeEach, it } from "vitest";
import {
  ITEM_IDS,
  ROCKET_COMPONENTS,
  TRACKS,
  type ItemId,
} from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  coreRowFor,
  createHarness,
  stageCargo,
  stageItems,
  stageTiers,
  type Harness,
  type Ore,
  type UpgradeTrack,
} from "../harness";
import { driveDeath, openAtCamp } from "../save/expedition";

/** The size the expedition is played at: not the one a session opens on. */
const SIZE = "quick" as const;

/** Everything the expedition had gathered, none of which may survive PLAY AGAIN. */
const EARNED = {
  credits: 9100,
  tiers: {
    fuel: 4,
    drill: 5,
    cargo: 3,
    hull: 3,
    jetpack: 4,
    radiator: 5,
    scanner: 3,
  } as Record<UpgradeTrack, number>,
  components: 4,
  items: {
    dynamite: 2,
    "plastic-explosives": 3,
    "quantum-teleporter": 1,
    "matter-transmitter": 1,
    nanobots: 2,
    "emergency-fuel": 4,
  } as Record<ItemId, number>,
  cargo: { cindrite: 3, aurite: 1 } as Partial<Record<Ore, number>>,
  materials: { resonite: 1, cryenite: 1 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("starts a fresh Hardcore expedition at the same size on PLAY AGAIN", async () => {
  await openAtCamp(h, { mode: "hardcore", size: SIZE });

  stageTiers(h, EARNED.tiers);
  h.debug.setCredits(EARNED.credits);
  h.debug.setRocketInstalled(EARNED.components);
  stageItems(h, EARNED.items);
  stageCargo(h, EARNED.cargo);
  h.debug.setMaterial("resonite", EARNED.materials.resonite);
  h.debug.setMaterial("cryenite", EARNED.materials.cryenite);

  await driveDeath(h, "hull-destroyed");

  h.debug.setMenuIndex(0);
  await h.tap(ACTION_KEY.activate);
  await h.advance(1);

  const fresh = h.snapshot();
  captureStill(h, "restart");

  assertEqual(
    fresh.screen,
    "in-mine",
    "specs/modes.md: PLAY AGAIN starts an expedition",
  );
  assertEqual(
    fresh.mode,
    "hardcore",
    "specs/modes.md: PLAY AGAIN stays in Hardcore",
  );
  assertEqual(
    fresh.worldSize,
    SIZE,
    "specs/modes.md: PLAY AGAIN starts at the same world size",
  );
  assertEqual(
    fresh.coreRow,
    coreRowFor(SIZE),
    "specs/world.md: coreRow follows the size the fresh expedition opened at",
  );

  assertEqual(
    fresh.credits,
    0,
    "specs/gameplay.md: a fresh expedition starts with 0 Credits",
  );
  for (const track of TRACKS) {
    assertEqual(
      fresh.tiers[track],
      1,
      `specs/gameplay.md: a fresh expedition starts at tier 1 on ${track}`,
    );
  }
  assertDeepEqual(
    fresh.rocket.installed,
    [],
    "specs/gameplay.md: a fresh expedition starts with no rocket component installed",
  );
  assertEqual(
    fresh.rocket.nextComponent,
    ROCKET_COMPONENTS[0].id,
    "specs/rocket.md: the checklist starts back at its first component",
  );
  for (const item of ITEM_IDS) {
    assertEqual(
      fresh.items[item],
      0,
      `specs/gameplay.md: a fresh expedition holds no ${item}`,
    );
  }
  assertDeepEqual(
    fresh.cargo.ore,
    {},
    "specs/gameplay.md: a fresh expedition starts with an empty cargo bay",
  );
  assertEqual(
    fresh.satchel.resonite,
    0,
    "specs/gameplay.md: a fresh expedition starts with an empty satchel",
  );
  assertEqual(
    fresh.satchel.cryenite,
    0,
    "specs/gameplay.md: a fresh expedition starts with an empty satchel",
  );
  assertEqual(
    fresh.miner.fuel,
    fresh.miner.maxFuel,
    "specs/gameplay.md: a fresh expedition starts with a full fuel tank",
  );
  assertEqual(
    fresh.miner.hull,
    fresh.miner.maxHull,
    "specs/gameplay.md: a fresh expedition starts with a full hull",
  );
});
