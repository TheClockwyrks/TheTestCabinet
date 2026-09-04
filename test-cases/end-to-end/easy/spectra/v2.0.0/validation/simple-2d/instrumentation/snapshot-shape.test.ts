// instrumentation/snapshot-shape — the snapshot reports the whole documented
// shape, off a field carrying one of everything.
//
// specs/instrumentation.md fixes it outright: "`snapshot` returns exactly this
// object. Every field an operation can set is present, so every operation is
// verifiable by setting a value and reading it back." This point holds a build to
// that object, field by field, at its documented type.
//
// THE FIELD IS POSED SO NO ROSTER IS EMPTY. A shape check over an empty field
// says nothing about the entries inside `drones`, `bullets` and `bursts`, so this
// poses a drone of each of the three kinds, one bullet each way, a live
// drone-burst and a live discharge wave — every part of the document that only
// exists while something is standing on the field.
//
// TWO OF THOSE ARE OUTCOMES RATHER THAN POSES, and that is the specification's
// design: "There is no operation that adds one. A burst is an outcome of a drone
// being destroyed", and "There is no operation that discharges. A caller checking
// the discharge poses the meter and drives the discharge action". So the burst is
// earned with a matching shot and the wave is released by holding the key
// specs/controls.md binds `discharge` to, over a meter posed to `RESONANCE_MAX`.
//
// WHAT THE POSED FIELD IS CLEAR OF. The discharge wave "reaches a thing when that
// thing's center lies inside the wave's current radius" and takes every enemy
// bullet and every drone that is not resting in formation
// (specs/resonance.md). The reading is taken one frame after the release, when
// the radius has grown a fraction of the way, and every posed drone rests in
// `formation` and the enemy bullet stands hundreds of units from the ship, so the
// field the shape is read off is the field that was posed.
//
// WHAT THIS DOES NOT DECIDE. Whether a posed value comes BACK, which is
// `instrumentation/poses-read-back`'s, or what any of these figures means, which
// belongs to the group that grades it. This point is about presence and type.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, RESONANCE_MAX } from "../constants";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertHasProperty,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  enemyBullets,
  playerBullets,
  poseDrone,
  startPosed,
  type Harness,
  type SpectraSnapshot,
} from "../harness";
import { poseBursts } from "./bursts";

/** The seven screens, the two phases, the two bands, the three drone kinds and
 * the four drone phases the specification's snapshot shape lists. */
const SCREENS = [
  "title",
  "howto",
  "stageIntro",
  "inWave",
  "paused",
  "stageCleared",
  "gameOver",
];
const PHASES = ["live", "ready"];
const BANDS = ["cyan", "magenta"];
const KINDS = ["shard", "flux", "prism"];
const DRONE_PHASES = ["entering", "formation", "diving", "returning"];

/** The two modes `mode` may report: the build ships one of them
 * (specs/mode.md). */
const MODES = ["sortie", "overload"];

/** Where the three drones rest, in logical units: three columns across the
 * formation grid's own band of the field, far apart and well inside `y` in
 * `[64, 656]` (specs/field.md). */
const DRONE_Y = 220;
const SHARD_X = 430;
const FLUX_X = 640;
const PRISM_X = 850;

/** Where the two bullets stand. The enemy one is put on the far side of the
 * field from the ship at `(640, 600)` — over five hundred units away — so the
 * discharge wave one frame old has not reached it (specs/resonance.md). */
const PLAYER_BULLET_X = 240;
const PLAYER_BULLET_Y = 520;
const ENEMY_BULLET_X = 300;
const ENEMY_BULLET_Y = 150;

/** How many bursts the field carries. */
const BURSTS = 1;

/** The key specs/controls.md binds the `discharge` action to. */
const DISCHARGE_KEY = BINDINGS.discharge[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every field of a number is a number, named for the failure message. */
function assertNumbers(
  holder: Record<string, unknown>,
  keys: readonly string[],
  where: string,
): void {
  for (const key of keys) {
    assertHasProperty(holder, key, `${where}.${key}`);
    assertEqual(typeof holder[key], "number", `${where}.${key} is a number`);
  }
}

/** Every field of a boolean is a boolean, named for the failure message. */
function assertBooleans(
  holder: Record<string, unknown>,
  keys: readonly string[],
  where: string,
): void {
  for (const key of keys) {
    assertHasProperty(holder, key, `${where}.${key}`);
    assertEqual(typeof holder[key], "boolean", `${where}.${key} is a boolean`);
  }
}

/** The whole documented shape, over the snapshot a posed field reported. */
function assertShape(s: SpectraSnapshot): void {
  const top = s as unknown as Record<string, unknown>;
  assertNumbers(
    top,
    [
      "version",
      "phaseTimer",
      "menuIndex",
      "stage",
      "score",
      "lives",
      "challengeHits",
      "resonance",
      "inversion",
      "diveClock",
      "droneSpeedScale",
      "bulletSpeedScale",
      "diveGapScale",
      "fluxHold",
      "simTime",
    ],
    "snapshot()",
  );
  assertBooleans(
    top,
    [
      "isChallenge",
      "extraLifeAwarded",
      "dischargeReady",
      "inversionActive",
      "muted",
      "waveEntry",
      "diveLaunching",
      "stageClearing",
    ],
    "snapshot()",
  );
  assertContains(SCREENS, s.screen, "snapshot().screen");
  assertContains(PHASES, s.phase, "snapshot().phase");
  assertContains(MODES, s.mode, "snapshot().mode");

  const ship = s.ship as unknown as Record<string, unknown>;
  assertNumbers(ship, ["x", "lockout", "cooldown"], "snapshot().ship");
  assertBooleans(ship, ["alive", "contact"], "snapshot().ship");
  assertContains(BANDS, s.ship.band, "snapshot().ship.band");

  const discharge = s.discharge as unknown as Record<string, unknown>;
  assertNumbers(discharge, ["radius"], "snapshot().discharge");
  assertBooleans(discharge, ["active"], "snapshot().discharge");

  for (const drone of s.drones) {
    const where = `snapshot().drones[id ${String(drone.id)}]`;
    const entry = drone as unknown as Record<string, unknown>;
    assertNumbers(
      entry,
      ["id", "x", "y", "slotX", "slotY", "bandClock"],
      where,
    );
    assertBooleans(
      entry,
      ["shimmer", "shellAlive", "travel", "oscillation", "fire"],
      where,
    );
    assertContains(KINDS, drone.kind, `${where}.kind`);
    assertContains(BANDS, drone.band, `${where}.band`);
    assertContains(BANDS, drone.effectiveBand, `${where}.effectiveBand`);
    assertContains(DRONE_PHASES, drone.phase, `${where}.phase`);
  }

  for (const bullet of s.bullets) {
    const where = `snapshot().bullets[id ${String(bullet.id)}]`;
    const entry = bullet as unknown as Record<string, unknown>;
    assertNumbers(entry, ["id", "x", "y", "vx", "vy"], where);
    assertBooleans(entry, ["friendly"], where);
    assertContains(BANDS, bullet.band, `${where}.band`);
    assertContains(BANDS, bullet.effectiveBand, `${where}.effectiveBand`);
  }

  for (const burst of s.bursts) {
    const where = `snapshot().bursts[id ${String(burst.id)}]`;
    const entry = burst as unknown as Record<string, unknown>;
    assertNumbers(
      entry,
      ["id", "x", "y", "size", "elapsed", "particles"],
      where,
    );
  }
}

it("reports every documented field, off a field carrying one of everything", async () => {
  // An empty, quiet, live wave to build on: nothing arrives, nothing dives and
  // nothing costs a life while the arrangement is made.
  startPosed(h);

  // The burst first, because it is earned with a shot and plays for a fixed
  // window; everything below is posed inside it.
  const burstIds = await poseBursts(h, BURSTS);

  // One drone of each kind, resting in formation with every faculty off, so the
  // discharge wave passes over them (specs/resonance.md) and nothing travels.
  const shard = poseDrone(h, "shard", SHARD_X, DRONE_Y, { band: "cyan" });
  const flux = poseDrone(h, "flux", FLUX_X, DRONE_Y, { band: "magenta" });
  const prism = poseDrone(h, "prism", PRISM_X, DRONE_Y, { band: "cyan" });

  // One bullet each way.
  h.debug.addPlayerBullet(PLAYER_BULLET_X, PLAYER_BULLET_Y, "cyan");
  h.debug.addEnemyBullet(ENEMY_BULLET_X, ENEMY_BULLET_Y, "magenta");

  // The live wave: the meter posed to the ceiling a discharge is available at,
  // and the key held for the one frame the release takes.
  h.debug.setResonance(RESONANCE_MAX);
  h.hold(DISCHARGE_KEY);
  await h.advance(1);
  h.release(DISCHARGE_KEY);

  captureStill(h, "posed");
  const s = h.snapshot();

  // The field really is the one this point reads: every roster carries what was
  // posed into it, and the wave is live.
  assertLength(s.drones, 3, "the three drones posed, one of each kind");
  assertEqual(s.drones[0]?.id, shard, "the Shard is first in the roster");
  assertEqual(s.drones[1]?.id, flux, "the Flux is second in the roster");
  assertEqual(s.drones[2]?.id, prism, "the Prism is third in the roster");
  assertLength(playerBullets(s), 1, "the player's bullet posed onto the field");
  assertLength(enemyBullets(s), 1, "the enemy bullet posed onto the field");
  assertLength(
    s.bursts,
    BURSTS,
    "the drone-burst a destroyed drone left behind",
  );
  assertEqual(s.bursts[0]?.id, burstIds[0], "the burst the kill left behind");
  assertTrue(
    s.discharge.active,
    "a discharge wave is live one frame after the action was driven at " +
      `RESONANCE_MAX (${String(RESONANCE_MAX)}, specs/resonance.md)`,
  );
  assertGreaterThan(
    s.discharge.radius,
    0,
    "the live wave's radius one frame into its life (specs/resonance.md)",
  );

  // And it reports the whole documented object.
  assertShape(s);
});
