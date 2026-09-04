// instrumentation/snapshot-shape — the snapshot reports the whole documented shape.
//
// `specs/instrumentation.md` writes `snapshot()`'s return out as a literal object
// and then fixes it: "The shape is fixed and every field is present on every
// screen." It is the one structure the case imposes on a build — everything else
// about how the game holds its state is the build's — and every other automated
// point in this project reads the game through it, so a field missing here is a
// field no check can see.
//
// SO THE EXPEDITION IS POSED TO EXERCISE EVERY BRANCH OF THE SHAPE, not to leave
// half of it at its resting value: ore in the bay, a material in the satchel, a
// live Core Sample with its timer running, a scanner with a node inside its
// range, rocket components installed, a notice already fired, and a cut in
// progress with the key still down. What is read is the TYPE of every field the
// specification lists, and the vocabulary of every field it fixes one for; the
// values themselves belong to the points about the things they measure.
//
// The `scanner` block is read against the rule the specification states over it
// rather than against a lock it is assumed to have: locked, the target is a
// material and the distance a number; unlocked, the target is null, the direction
// is zero, and the distance is null.
//
// Fields at their resting values on a fresh expedition — `summary`, `panel`,
// `notice` — are read here for presence and type, and by
// `snapshot-resting-values` for the values they rest at.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertHasProperty,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  DEEPCORE_DEBUG_VERSION,
  ITEM_IDS,
  MATERIALS,
  MINER_STATES,
  MODES,
  PANELS,
  ROCKET_COMPONENT_IDS,
  SCREENS,
  UPGRADE_TRACKS,
  WORLD_SIZES,
} from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  layMaterial,
  openScene,
  stageCargo,
  stageTiers,
  standOn,
  type Harness,
} from "../harness";

const COL = 8;
const ROW = 12;

/** How far into the cut the snapshot is read, in frames of the suite's clock. */
const CUT_FRAMES = 20;

let h: Harness;

/** A number the specification documents as a number. */
function assertNumber(value: unknown, at: string): void {
  assertEqual(typeof value, "number", at);
  assertEqual(Number.isFinite(value as number), true, `${at} is finite`);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports every documented field, with its documented type", async () => {
  await openScene(h);
  // The ground the cut bites into, and the miner braced on it.
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW, "west");
  // A haul, a material, a Core Sample on its timer, a scanner with a node in
  // range, rocket progress, a notice already fired, and Credits banked.
  await stageCargo(h, { ferron: 3, verdite: 1 });
  await h.debug.setMaterial("cryenite", 2);
  await h.debug.setCoreCarried(true);
  await stageTiers(h, { scanner: 2 });
  await layMaterial(h, COL + 3, ROW, "resonite");
  await h.debug.setRocketInstalled(2);
  await h.debug.setNoticeFired("gas", true);
  await h.debug.setCredits(1234);

  // Read with the cut running, so `drilling` is a cut rather than `null`.
  await h.hold(ACTION_KEY.down);
  await h.advance(CUT_FRAMES);
  const s = await h.snapshot();
  await captureStill(h, "posed");
  await h.release(ACTION_KEY.down);

  assertEqual(s.version, DEEPCORE_DEBUG_VERSION, "version");
  assertContains(SCREENS, s.screen, "screen");
  if (s.panel !== null) assertContains(PANELS, s.panel, "panel");
  assertContains(MODES, s.mode, "mode");
  assertContains(WORLD_SIZES, s.worldSize, "worldSize");
  assertNumber(s.coreRow, "coreRow");
  assertNumber(s.menuIndex, "menuIndex");
  assertEqual(typeof s.autoStep, "boolean", "autoStep");
  assertEqual(typeof s.muted, "boolean", "muted");
  assertNumber(s.simTime, "simTime");
  assertEqual(typeof s.hasSave, "boolean", "hasSave");
  assertNumber(s.credits, "credits");
  assertNumber(s.creditsEarned, "creditsEarned");
  assertNumber(s.depthMeters, "depthMeters");
  assertNumber(s.deepestDepthMeters, "deepestDepthMeters");

  // A Core Sample is live, so its timer is a number and it is carried rather
  // than lying on the ground.
  assertNotNull(s.coreTimer, "coreTimer with a Sample live");
  assertNumber(s.coreTimer, "coreTimer");
  assertNull(s.coreGround, "coreGround with the Sample carried");

  assertNumber(s.camera.x, "camera.x");
  assertNumber(s.camera.y, "camera.y");
  assertNumber(s.camera.lead, "camera.lead");

  for (const field of ["x", "y", "vx", "vy", "col", "row"] as const) {
    assertNumber(s.miner[field], `miner.${field}`);
  }
  assertContains(["east", "west"], s.miner.facing, "miner.facing");
  assertContains(MINER_STATES, s.miner.state, "miner.state");
  for (const field of ["grounded", "travel", "drill", "overloaded"] as const) {
    assertEqual(typeof s.miner[field], "boolean", `miner.${field}`);
  }
  for (const field of ["fuel", "maxFuel", "hull", "maxHull"] as const) {
    assertNumber(s.miner[field], `miner.${field}`);
  }
  assertNotNull(s.miner.drilling, "miner.drilling with the cut running");
  assertNumber(s.miner.drilling?.col, "miner.drilling.col");
  assertNumber(s.miner.drilling?.row, "miner.drilling.row");
  assertContains(
    ["down", "left", "right"],
    s.miner.drilling?.dir,
    "miner.drilling.dir",
  );
  assertNumber(s.miner.drilling?.progress, "miner.drilling.progress");

  for (const field of [
    "slotsUsed",
    "slotCap",
    "loadKg",
    "liftLimitKg",
  ] as const) {
    assertNumber(s.cargo[field], `cargo.${field}`);
  }
  assertNumber(s.cargo.ore.ferron, "cargo.ore.ferron");
  assertNumber(s.cargo.ore.verdite, "cargo.ore.verdite");

  for (const material of MATERIALS) {
    assertNumber(s.satchel[material], `satchel.${material}`);
  }
  assertEqual(typeof s.satchel.coreSample, "boolean", "satchel.coreSample");

  for (const track of UPGRADE_TRACKS) {
    assertNumber(s.tiers[track], `tiers.${track}`);
  }
  for (const item of ITEM_IDS) {
    assertNumber(s.items[item], `items.${item}`);
  }

  assertEqual(Array.isArray(s.rocket.installed), true, "rocket.installed");
  for (const id of s.rocket.installed) {
    assertContains(ROCKET_COMPONENT_IDS, id, "an id in rocket.installed");
  }
  if (s.rocket.nextComponent !== null) {
    assertContains(
      ROCKET_COMPONENT_IDS,
      s.rocket.nextComponent,
      "rocket.nextComponent",
    );
  }

  assertEqual(typeof s.scanner.locked, "boolean", "scanner.locked");
  assertNumber(s.scanner.dirX, "scanner.dirX");
  assertNumber(s.scanner.dirY, "scanner.dirY");
  if (s.scanner.locked) {
    assertContains(MATERIALS, s.scanner.target, "scanner.target while locked");
    assertNumber(s.scanner.distanceTiles, "scanner.distanceTiles while locked");
  } else {
    assertNull(s.scanner.target, "scanner.target while nothing is locked");
    assertEqual(s.scanner.dirX, 0, "scanner.dirX while nothing is locked");
    assertEqual(s.scanner.dirY, 0, "scanner.dirY while nothing is locked");
    assertNull(
      s.scanner.distanceTiles,
      "scanner.distanceTiles while nothing is locked",
    );
  }

  if (s.notice !== null) {
    assertContains(["gas", "lava"], s.notice.hazard, "notice.hazard");
    assertEqual(typeof s.notice.shown, "boolean", "notice.shown");
  }
  assertEqual(typeof s.noticesFired.gas, "boolean", "noticesFired.gas");
  assertEqual(typeof s.noticesFired.lava, "boolean", "noticesFired.lava");

  // Present whatever it holds: the expedition is still running, so it is `null`,
  // and the field is there rather than missing.
  assertHasProperty(s, "summary", "the snapshot");
  assertHasProperty(s, "panel", "the snapshot");
  assertHasProperty(s, "notice", "the snapshot");
});
