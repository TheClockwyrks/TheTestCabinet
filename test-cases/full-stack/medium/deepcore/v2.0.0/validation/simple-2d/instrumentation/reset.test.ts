// instrumentation/reset — reset returns the game to its title-screen values.
//
// `specs/instrumentation.md` writes the restored state out in full: "the `title`
// screen with `menuIndex` at `0`, no expedition in progress, mode `standard` and
// world size `standard`, an empty mine as `clearMine` leaves one, no panel open,
// the miner standing on the camp ground at `SPAWN_COL` facing `east` at rest,
// tier `1` on every upgrade track, a full fuel tank and a full hull, `0` Credits,
// an empty cargo bay, an empty satchel, no field supplies, no rocket component
// installed, no live Core Sample, no ground item, neither hazard notice fired,
// the camera lead at `0`, both faculties running, and `simTime` and
// `elapsedSeconds` at `0`."
//
// And one exception, for a stated reason: "`muted` is untouched, because muting is
// a player preference rather than a value an expedition opens with." Muting is the
// engine's under this engine and the surface carries no operation for it, so the
// mute is set the way a player sets it — `specs/controls.md` binds the `mute`
// action to `KeyM` — and read back off the snapshot, which the game refreshes from
// the runtime every update.
//
// WHY IT IS THE POINT THAT FAILS A BUILD OUTRIGHT. Every check in this project
// opens on a `reset`. A field it leaves dirty is a field the next scenario
// inherits, so a partial `reset` does not fail one point, it makes every point's
// world the previous one's leftovers.
//
// SO EVERYTHING IT RESTORES IS DIRTIED FIRST, deliberately and by hand, and the
// whole list is read back in one go. The reading is taken before any frame runs,
// because `simTime` is one of the fields restored and because the miner is
// restored to a camp whose ground the empty mine does not have — a frame would
// have it falling, correctly, out of the state being read.

import { afterEach, beforeEach, it } from "vitest";
import {
  ITEM_IDS,
  MATERIALS,
  ROCKET_COMPONENTS,
  SPAWN_COL,
  SURFACE_Y,
  TRACKS,
} from "../constants";
import {
  assertBetween,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNull,
} from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  minerFeet,
  minerXOn,
  minerYOn,
  openScene,
  placeAt,
  stageCargo,
  stageItems,
  stageTiers,
  type Harness,
} from "../harness";

/** The seed the restored state is opened on. */
const SEED = 7;

/** A cell of the mine well clear of the camp and the Core chamber. */
const COL = 8;
const ROW = 220;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores the whole title-screen state, and leaves muted alone", async () => {
  // Dirty every field the specification says a reset restores.
  openScene(h, { mode: "hardcore", size: "marathon" });
  h.debug.generateMine();
  // The player preference, set the way a player sets it, while the mine is the
  // screen that reads the action.
  await h.tap(ACTION_KEY.mute);
  assertEqual(h.snapshot().muted, true, "the mute the player turned on");

  h.debug.setCredits(9000);
  stageTiers(h, {
    fuel: 3,
    drill: 4,
    cargo: 2,
    hull: 5,
    jetpack: 3,
    radiator: 2,
    scanner: 3,
  });
  stageCargo(h, { ferron: 6, cobaltine: 2 });
  h.debug.setMaterial("resonite", 2);
  h.debug.setMaterial("cryenite", 1);
  stageItems(h, { dynamite: 4, nanobots: 2 });
  h.debug.setRocketInstalled(3);
  h.debug.setCoreCarried(true);
  h.debug.setNoticeFired("gas", true);
  h.debug.setNoticeFired("lava", true);
  h.debug.setCameraLead(120);
  h.debug.setElapsed(90);
  h.debug.setPanel("upgrade-shop");
  h.debug.setFacing("west");
  placeAt(h, minerXOn(COL), minerYOn(ROW));
  h.debug.setFuel(12);
  h.debug.setHull(9);
  h.debug.setMinerTravel(false);
  h.debug.setMinerDrill(false);
  // The highlighted item is dirtied on a screen that HAS a menu, since
  // `setMenuIndex` is bounded by the range the current screen holds and `in-mine`
  // holds one item.
  h.debug.setScreen("mode-select");
  h.debug.setMenuIndex(2);
  await h.advance(30);

  const dirty = h.snapshot();
  assertGreaterThan(
    dirty.simTime,
    0,
    "the game time a reset is asked to clear",
  );

  h.debug.reset({ seed: SEED });
  const s = h.snapshot();

  // The screen and the expedition.
  assertEqual(s.screen, "title", "screen");
  assertEqual(s.menuIndex, 0, "menuIndex");
  assertNull(s.panel, "panel");
  assertEqual(s.mode, "standard", "mode");
  assertEqual(s.worldSize, "standard", "worldSize");
  assertEqual(s.simTime, 0, "simTime");
  assertEqual(s.elapsedSeconds, 0, "elapsedSeconds");
  assertNull(s.summary, "summary");

  // The mine, as `clearMine` leaves one.
  assertEqual(h.tileAt(COL, ROW).kind, "tunnel", `the cell (${COL}, ${ROW})`);
  assertEqual(h.tileAt(COL, 1).kind, "tunnel", `the cell (${COL}, 1)`);

  // The miner, on the camp ground at the spawn, facing east, at rest. The COLUMN
  // rather than an exact `x`: `specs/expedition.md` puts the miner at `SPAWN_COL`
  // and leaves where within that column to the build.
  assertEqual(s.miner.col, SPAWN_COL, "the miner's spawn column");
  assertBetween(
    minerFeet(s.miner),
    SURFACE_Y - 1,
    SURFACE_Y,
    "the miner's feet on the camp ground",
  );
  assertEqual(s.miner.vx, 0, "the miner's vx");
  assertEqual(s.miner.vy, 0, "the miner's vy");
  assertEqual(s.miner.facing, "east", "the miner's facing");
  assertEqual(s.miner.travel, true, "the travel faculty");
  assertEqual(s.miner.drill, true, "the drill faculty");
  assertEqual(s.miner.fuel, s.miner.maxFuel, "the fuel tank");
  assertEqual(s.miner.hull, s.miner.maxHull, "the hull");

  // The tiers, the holdings and the rocket.
  for (const track of TRACKS) {
    assertEqual(s.tiers[track], 1, `the ${track} tier`);
  }
  assertEqual(s.credits, 0, "credits");
  assertEqual(s.creditsEarned, 0, "creditsEarned");
  assertEqual(s.cargo.slotsUsed, 0, "the slots used");
  assertDeepEqual(s.cargo.ore, {}, "the ore held");
  for (const material of MATERIALS) {
    assertEqual(s.satchel[material], 0, `the ${material} held`);
  }
  assertEqual(s.satchel.coreSample, false, "the Core Sample held");
  for (const item of ITEM_IDS) {
    assertEqual(s.items[item], 0, `the ${item} held`);
  }
  assertDeepEqual(s.rocket.installed, [], "the components installed");
  assertEqual(
    s.rocket.nextComponent,
    ROCKET_COMPONENTS[0].id,
    "the next component",
  );

  // The hazards, the Sample and the camera.
  assertNull(s.coreTimer, "coreTimer");
  assertNull(s.coreGround, "coreGround");
  assertEqual(s.noticesFired.gas, false, "the gas notice");
  assertEqual(s.noticesFired.lava, false, "the lava notice");
  assertNull(s.notice, "notice");
  assertEqual(s.camera.lead, 0, "the camera lead");

  // And the one preference a reset does not touch.
  assertEqual(
    s.muted,
    true,
    "muted, which a reset leaves as the player set it",
  );

  // The picture: the title the reset restored.
  await h.advance(1);
  captureStill(h, "title");
});
