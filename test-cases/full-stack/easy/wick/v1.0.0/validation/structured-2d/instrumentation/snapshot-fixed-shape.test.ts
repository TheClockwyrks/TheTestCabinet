// Wick — instrumentation/snapshot-fixed-shape: the snapshot carries every
// documented field on each of the nine screens, `almanacTab`, `almanacScroll`,
// and `run.hurtFlash` among them, with `run` the idle run on `title`, `howto`,
// and `almanac`, the run that just ended on `fallen` and `dawn`, `pool` empty
// everywhere but `levelup`, and `menuIndex` `0` on a screen with no menu.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Snapshot shape": "The shape is fixed, and every field is present whatever
// the screen. `run` reports the idle run of `specs/state.md` on `title`,
// `howto`, and `almanac`, and the run that just ended on `fallen` and `dawn`";
// the `pool` row of the derived table: "on every other screen an empty list";
// and "`almanacTab` and `almanacScroll` sit beside `menuIndex`, outside
// `run`". `specs/state.md`, "The idle run", the table `IDLE_RUN` transcribes,
// and "`menuIndex` ... on a screen with no menu it stays `0`" — `howto`,
// `playing`, and `chest` show no menu, while `title`, `almanac`, `levelup`,
// `paused`, `fallen`, and `dawn` each show one (`specs/ui.md`).
//
// THE SWEEP. Each screen is reached through the surface and the real ticks
// (`reset`, `setScreen`, and the harness's `openLevelUp`, `openChest`,
// `endFallen`, `endDawn`, which run the one tick that opens or ends), from an
// isolated run whose kills are posed to 3 so the ended run is told from the
// idle one. The still is the last screen of the sweep.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertHasProperty } from "../assert";
import { DAWN_TICK } from "../constants";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  endDawn,
  endFallen,
  isolate,
  openChest,
  openLevelUp,
  poseScreen,
  type Harness,
  type Screen,
  type WickSnapshot,
} from "../harness";

const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "menuIndex",
  "almanacTab",
  "almanacScroll",
  "spawning",
  "events",
  "despawning",
  "enemyMotion",
  "enemyContact",
  "weaponFire",
  "effectMotion",
  "drops",
  "progression",
  "run",
  "muted",
  "accumulator",
  "simTime",
] as const;

const RUN_FIELDS = [
  "tick",
  "time",
  "level",
  "xp",
  "xpToNext",
  "kills",
  "player",
  "hurtFlash",
  "maxHp",
  "armor",
  "moveSpeed",
  "pickupRadius",
  "weapons",
  "passives",
  "enemies",
  "projectiles",
  "zones",
  "gems",
  "pickups",
  "offers",
  "pool",
  "nextOffers",
  "pendingLevelUps",
  "chestResult",
  "spawnTimer",
  "spawnWindow",
  "firedEvents",
  "aliveCommons",
  "nextId",
  "nextSpawnAngle",
  "nextSwarmAngle",
  "nextPuddleOffset",
  "nextStrikeTarget",
  "nextChestItem",
  "nextDrop",
] as const;

/** The screens that show no menu (specs/ui.md). */
const MENULESS: readonly Screen[] = ["howto", "playing", "chest"];

/** Kills posed on the run that ends, so the ended run reads apart from idle. */
const POSED_KILLS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Every field present, and the per-screen rules that hold on every screen. */
function checkShape(s: WickSnapshot, screen: Screen): void {
  assertEqual(s.screen, screen, `screen reached for ${screen}`);
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(s, field, `snapshot() on ${screen}`);
  }
  for (const field of RUN_FIELDS) {
    assertHasProperty(s.run, field, `snapshot().run on ${screen}`);
  }
  if (screen !== "levelup") {
    assertDeepEqual(s.run.pool, [], `run.pool on ${screen}`);
  }
  if (MENULESS.includes(screen)) {
    assertEqual(s.menuIndex, 0, `menuIndex on ${screen}, which has no menu`);
  }
}

it("carries every field on all nine screens, run and pool as each screen states", async () => {
  h.reset();
  checkShape(h.snapshot(), "title");
  assertDeepEqual(h.snapshot().run, IDLE_RUN, "run on title");

  checkShape(poseScreen(h, "howto"), "howto");
  assertDeepEqual(h.snapshot().run, IDLE_RUN, "run on howto");

  checkShape(poseScreen(h, "almanac"), "almanac");
  assertDeepEqual(h.snapshot().run, IDLE_RUN, "run on almanac");

  checkShape(isolate(h), "playing");

  isolate(h);
  const levelup = await openLevelUp(h, 1);
  checkShape(levelup, "levelup");

  isolate(h);
  checkShape(await openChest(h), "chest");

  isolate(h);
  checkShape(poseScreen(h, "paused"), "paused");

  isolate(h);
  h.debug.setKills(POSED_KILLS);
  const fallen = await endFallen(h);
  checkShape(fallen, "fallen");
  assertEqual(fallen.run.kills, POSED_KILLS, "run.kills kept on fallen");
  assertEqual(fallen.run.tick, 1, "run.tick of the ended run on fallen");

  isolate(h);
  h.debug.setKills(POSED_KILLS);
  const dawn = await endDawn(h);
  await h.frameDraw();
  captureStill(h, "screens");
  checkShape(dawn, "dawn");
  assertEqual(dawn.run.kills, POSED_KILLS, "run.kills kept on dawn");
  assertEqual(dawn.run.tick, DAWN_TICK, "run.tick of the ended run on dawn");
});
