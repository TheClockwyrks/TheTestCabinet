// screens/pause-restart — RESTART begins the expedition again at the same
// settings.
//
// specs/ui.md: on `paused`, "`RESTART` starts a fresh expedition in the same mode
// and size". specs/gameplay.md says what a fresh expedition is: tier `1` on every
// upgrade track, a full fuel tank and a full hull, `0` Credits, an empty cargo
// bay, an empty satchel, no field supplies, and no rocket component installed.
//
// SO THE READING IS TWO-SIDED, and the two sides are what make RESTART different
// from QUIT TO MENU: the mode and the size are UNCHANGED, and every holding is
// BACK AT ITS STARTING VALUE. Each holding is posed away from that value first,
// so a build that carried anything through is caught on the value it carried.
//
// ISOLATION. A Hardcore expedition at the Quick size, neither of which a session
// opens at, so "the same mode and size" is a real reading; an empty mine; and the
// pause menu reached directly through the surface, because a build with a broken
// pause key and a working RESTART must pass this and fail that one.

import { afterEach, beforeEach, it } from "vitest";
import {
  ITEM_IDS,
  PAUSE_ITEMS,
  TRACKS,
  type ItemId,
  type OreId,
  type TrackName,
} from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  coreRowFor,
  createHarness,
  openScene,
  stageCargo,
  stageItems,
  stageTiers,
  type Harness,
} from "../harness";

/** Settings a session never opens at, so "the same" is a real reading. */
const MODE = "hardcore" as const;
const SIZE = "quick" as const;

/** Everything the expedition had gathered, none of which may survive a RESTART. */
const EARNED = {
  credits: 6400,
  tiers: {
    fuel: 3,
    drill: 2,
    cargo: 4,
    hull: 2,
    jetpack: 5,
    radiator: 3,
    scanner: 2,
  } as Record<TrackName, number>,
  components: 3,
  items: {
    dynamite: 1,
    "plastic-explosives": 2,
    "quantum-teleporter": 3,
    "matter-transmitter": 1,
    nanobots: 1,
    "emergency-fuel": 2,
  } as Record<ItemId, number>,
  cargo: { halcite: 2, verdite: 1 } as Partial<Record<OreId, number>>,
  materials: { resonite: 1, cryenite: 1 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts over in the same mode and size with every holding reset", async () => {
  openScene(h, { mode: MODE, size: SIZE });

  stageTiers(h, EARNED.tiers);
  h.debug.setCredits(EARNED.credits);
  h.debug.setRocketInstalled(EARNED.components);
  stageItems(h, EARNED.items);
  stageCargo(h, EARNED.cargo);
  h.debug.setMaterial("resonite", EARNED.materials.resonite);
  h.debug.setMaterial("cryenite", EARNED.materials.cryenite);

  h.debug.setScreen("paused");
  h.debug.setMenuIndex(PAUSE_ITEMS.indexOf("RESTART"));
  await h.tap(ACTION_KEY.activate);
  await h.advance(1);

  const fresh = h.snapshot();
  captureStill(h, "restart");

  assertEqual(
    fresh.screen,
    "in-mine",
    "specs/ui.md: RESTART starts a fresh expedition",
  );
  assertEqual(fresh.mode, MODE, "specs/ui.md: RESTART keeps the same mode");
  assertEqual(
    fresh.worldSize,
    SIZE,
    "specs/ui.md: RESTART keeps the same world size",
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
