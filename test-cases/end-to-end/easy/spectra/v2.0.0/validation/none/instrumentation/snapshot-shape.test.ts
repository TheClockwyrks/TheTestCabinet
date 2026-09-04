// Spectra — instrumentation/snapshot-shape: `snapshot()` reports the whole object
// `specs/instrumentation.md` documents, with every field at its documented type,
// read off a field that is actually carrying one of everything.
//
// That file fixes the shape exactly, under Snapshot shape — "`snapshot` returns
// exactly this object. Every field an operation can set is present, so every
// operation is verifiable by setting a value and reading it back" — and the rest
// of this suite reads its verdicts out of that object. A field that is absent, or
// that answers with something of the wrong kind, therefore costs the point that
// asks for it somewhere else, under a heading about a mechanic. This point names
// it here instead.
//
// THE FIELD IS POSED SO NO ROSTER IS EMPTY. An empty array satisfies "is an array"
// while saying nothing about the entries the specification describes, so the field
// carries one drone of each of the three kinds `specs/drones.md` names, one bullet
// each way, a drone-burst playing, and a live discharge wave — and every per-entry
// field is read off a real entry.
//
// TWO OF THOSE CANNOT BE POSED AND HAVE TO BE DRIVEN. There is no operation that
// adds a burst — "A burst is an outcome of a drone being destroyed"
// (`specs/instrumentation.md`, The bursts) — so a Shard is destroyed by a matching
// shot to leave one; and there is no operation that discharges — "A caller
// checking the discharge poses the meter and drives the discharge action" (that
// file, Resonance and the inversion) — so the meter is posed to `RESONANCE_MAX`
// and the key `specs/controls.md` binds is pressed. Both are read back as
// preconditions before the shape is read, so a build that failed to produce one is
// named for that rather than for a missing field.
//
// NOTHING ON THE FIELD IS IN THE DISCHARGE'S REACH. `specs/resonance.md` has the
// wave destroy a drone in phase `entering`, `diving` or `returning` and take any
// enemy bullet it reaches, and leave a drone in phase `formation` alone. Every
// drone here rests in `formation` and the enemy bullet hangs in the far corner,
// nearly seven hundred units from the ship the wave grows out of, so nothing the
// shape is read off is swept between the release and the reading.
//
// WHAT THIS DOES NOT DECIDE. Nothing about the VALUES beyond the two that make the
// reading non-vacuous — that a burst and a discharge exist at all. That each pose
// is read back is `instrumentation/poses-read-back`'s, what a band means is
// `bands/*`'s, and what the wave reaches is `resonance/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  BANDS,
  BINDINGS,
  RESONANCE_MAX,
  SPECTRA_DEBUG_VERSION,
  type Mode,
} from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  shootDrone,
  startPosed,
  type DroneKind,
  type DronePhase,
  type Harness,
  type Phase,
  type Screen,
} from "../harness";

/** The seven screens, the two phases, the three kinds and the four drone phases. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "stageIntro",
  "inWave",
  "paused",
  "stageCleared",
  "gameOver",
];
const PHASES: readonly Phase[] = ["live", "ready"];
const KINDS: readonly DroneKind[] = ["shard", "flux", "prism"];
const DRONE_PHASES: readonly DronePhase[] = [
  "entering",
  "formation",
  "diving",
  "returning",
];
/** The two modes `specs/mode.md` defines, one per variant of this case. */
const MODES: readonly Mode[] = ["sortie", "overload"];

/** Where one drone of each kind rests, spread across the upper play field. */
const KIND_AT: readonly { kind: DroneKind; x: number; y: number }[] = [
  { kind: "shard", x: 300, y: 200 },
  { kind: "flux", x: 500, y: 200 },
  { kind: "prism", x: 700, y: 200 },
];

/** How far a Flux is into its band window when it is posed, in seconds. */
const FLUX_CLOCK = 0.5;

/** Where the drone that is destroyed to leave a burst stands. */
const POP_AT = { x: 1000, y: 460 } as const;

/**
 * How far below it the shot starts, and the frames it is allowed.
 *
 * A Shard's contact reach is `SHARD_HALF` (14) plus `PLAYER_BULLET_HALF` (6), so
 * `60` puts the bullet in flight rather than in contact; at
 * `PLAYER_BULLET_SPEED` (760) it covers that in six frames of the suite's 100 Hz
 * clock, and twenty-five leaves ample slack for whichever frame the build
 * resolves the contact on.
 */
const SHOT_BELOW = 60;
const SHOT_FRAMES = 25;

/** Where the two posed bullets hang, in columns nothing else occupies. */
const FRIENDLY_AT = { x: 150, y: 620 } as const;
const ENEMY_AT = { x: 1150, y: 120 } as const;

/**
 * Frames the discharge press is given to release the wave.
 *
 * `specs/controls.md` reads `discharge` as a press edge and `specs/resonance.md`
 * starts the wave on the action, so one frame is the figure; three cover the
 * frame the key-down itself is delivered on and leave the wave `0.03` s into its
 * `DISCHARGE_TIME` (`0.5` s) life when the shape is read.
 */
const RELEASE_FRAMES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reports every documented field, from a field carrying one of everything", async () => {
  await startPosed(h);

  // One drone of each kind, resting in formation with every faculty off: this
  // point reads their fields, and a drone that wandered would be reporting
  // another point's mechanic.
  for (const at of KIND_AT) {
    await poseDrone(h, at.kind, at.x, at.y, {
      band: "cyan",
      bandClock: at.kind === "flux" ? FLUX_CLOCK : undefined,
    });
  }

  // The burst, which can only be an outcome: a matching shot into a Shard.
  const target = await poseDrone(h, "shard", POP_AT.x, POP_AT.y, {
    band: "cyan",
  });
  const shot = await shootDrone(h, target, "cyan", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  assertEqual(
    shot.hit && droneById(shot.snapshot, target) === undefined,
    true,
    `the Shard at (${POP_AT.x}, ${POP_AT.y}) destroyed by one of the player's ` +
      `bullets carrying its own band (specs/bands.md) — without the kill there ` +
      `is no burst to read a shape off`,
  );

  // One bullet each way, placed after the shot so the roster holds exactly these.
  await h.debug.addPlayerBullet(FRIENDLY_AT.x, FRIENDLY_AT.y, "cyan");
  await h.debug.addEnemyBullet(ENEMY_AT.x, ENEMY_AT.y, "magenta");

  // And the wave, which is likewise an outcome: the meter at the ceiling
  // specs/resonance.md makes a discharge available at, and the real key.
  await h.debug.setResonance(RESONANCE_MAX);
  await h.hold(BINDINGS.discharge[0]);
  const fired = await h.until((s) => s.discharge.active, {
    maxFrames: RELEASE_FRAMES,
  });
  await h.release(BINDINGS.discharge[0]);
  // The posed field with the wave spreading over it.
  await captureStill(h, "posed");
  assertTrue(
    fired.hit,
    `a discharge wave to be live within ${RELEASE_FRAMES} frames of the ` +
      `${BINDINGS.discharge[0]} key going down with the meter at ` +
      `RESONANCE_MAX (${RESONANCE_MAX}) (specs/resonance.md) — without one ` +
      `there is no live discharge to read a shape off`,
  );

  const s = await h.snapshot();

  // ---- The scalars --------------------------------------------------------

  assertEqual(s.version, SPECTRA_DEBUG_VERSION, "snapshot().version");
  assertContains(SCREENS, s.screen, "snapshot().screen");
  assertContains(PHASES, s.phase, "snapshot().phase");
  assertEqual(typeof s.phaseTimer, "number", "snapshot().phaseTimer");
  assertEqual(typeof s.menuIndex, "number", "snapshot().menuIndex");
  assertContains(MODES, s.mode, "snapshot().mode, the mode this build ships");
  assertEqual(typeof s.stage, "number", "snapshot().stage");
  assertEqual(
    typeof s.isChallenge,
    "boolean",
    "snapshot().isChallenge, derived from stage (specs/stages.md)",
  );
  assertEqual(typeof s.score, "number", "snapshot().score");
  assertEqual(typeof s.lives, "number", "snapshot().lives");
  assertEqual(
    typeof s.extraLifeAwarded,
    "boolean",
    "snapshot().extraLifeAwarded, the run's one-extra-life latch",
  );
  assertEqual(typeof s.resonance, "number", "snapshot().resonance");
  assertEqual(
    typeof s.dischargeReady,
    "boolean",
    "snapshot().dischargeReady, derived from resonance (specs/resonance.md)",
  );
  assertEqual(
    typeof s.inversion,
    "number",
    "snapshot().inversion, which is SECONDS remaining",
  );
  assertEqual(
    typeof s.inversionActive,
    "boolean",
    "snapshot().inversionActive, derived from inversion (specs/bands.md)",
  );
  assertEqual(typeof s.muted, "boolean", "snapshot().muted");
  assertEqual(typeof s.waveEntry, "boolean", "snapshot().waveEntry");
  assertEqual(typeof s.diveLaunching, "boolean", "snapshot().diveLaunching");
  assertEqual(
    typeof s.diveClock,
    "number",
    "snapshot().diveClock, the wave's own dive timer",
  );
  assertEqual(
    typeof s.droneSpeedScale,
    "number",
    "snapshot().droneSpeedScale, derived from stage (specs/stages.md)",
  );
  assertEqual(
    typeof s.bulletSpeedScale,
    "number",
    "snapshot().bulletSpeedScale, derived from stage (specs/stages.md)",
  );
  assertEqual(
    typeof s.diveGapScale,
    "number",
    "snapshot().diveGapScale, derived from stage (specs/stages.md)",
  );
  assertEqual(
    typeof s.fluxHold,
    "number",
    "snapshot().fluxHold, in seconds, derived from stage (specs/stages.md)",
  );
  assertEqual(typeof s.simTime, "number", "snapshot().simTime");

  // ---- The ship and the wave ----------------------------------------------

  assertEqual(typeof s.ship.x, "number", "snapshot().ship.x");
  assertContains(BANDS, s.ship.band, "snapshot().ship.band");
  assertEqual(
    typeof s.ship.alive,
    "boolean",
    "snapshot().ship.alive, derived from phase (specs/progression.md)",
  );
  assertEqual(typeof s.ship.lockout, "number", "snapshot().ship.lockout");
  assertEqual(typeof s.ship.cooldown, "number", "snapshot().ship.cooldown");
  assertEqual(typeof s.ship.contact, "boolean", "snapshot().ship.contact");

  assertEqual(
    typeof s.discharge.active,
    "boolean",
    "snapshot().discharge.active",
  );
  assertEqual(
    typeof s.discharge.radius,
    "number",
    "snapshot().discharge.radius, in logical units",
  );

  // ---- The three rosters, each read off real entries ------------------------

  assertLength(
    s.drones,
    KIND_AT.length,
    "the drones on the field, of which this scenario posed one of each kind",
  );
  for (const drone of s.drones) {
    assertEqual(typeof drone.id, "number", "snapshot().drones[].id");
    assertContains(KINDS, drone.kind, "snapshot().drones[].kind");
    assertEqual(typeof drone.x, "number", "snapshot().drones[].x");
    assertEqual(typeof drone.y, "number", "snapshot().drones[].y");
    assertContains(
      BANDS,
      drone.band,
      "snapshot().drones[].band, its STORED band",
    );
    assertContains(
      BANDS,
      drone.effectiveBand,
      "snapshot().drones[].effectiveBand (specs/bands.md)",
    );
    assertContains(
      DRONE_PHASES,
      drone.phase,
      "snapshot().drones[].phase (specs/swarm.md)",
    );
    assertEqual(typeof drone.slotX, "number", "snapshot().drones[].slotX");
    assertEqual(typeof drone.slotY, "number", "snapshot().drones[].slotY");
    assertEqual(
      typeof drone.bandClock,
      "number",
      "snapshot().drones[].bandClock, in seconds into the current window",
    );
    assertEqual(
      typeof drone.shimmer,
      "boolean",
      "snapshot().drones[].shimmer, derived (specs/drones.md)",
    );
    assertEqual(
      typeof drone.shellAlive,
      "boolean",
      "snapshot().drones[].shellAlive",
    );
    assertEqual(typeof drone.travel, "boolean", "snapshot().drones[].travel");
    assertEqual(
      typeof drone.oscillation,
      "boolean",
      "snapshot().drones[].oscillation",
    );
    assertEqual(typeof drone.fire, "boolean", "snapshot().drones[].fire");
  }

  assertLength(
    s.bullets,
    2,
    "the bullets in flight, of which this scenario placed one of each kind",
  );
  for (const bullet of s.bullets) {
    assertEqual(typeof bullet.id, "number", "snapshot().bullets[].id");
    assertEqual(typeof bullet.x, "number", "snapshot().bullets[].x");
    assertEqual(typeof bullet.y, "number", "snapshot().bullets[].y");
    assertEqual(
      typeof bullet.vx,
      "number",
      "snapshot().bullets[].vx, in logical units per second",
    );
    assertEqual(
      typeof bullet.vy,
      "number",
      "snapshot().bullets[].vy, in logical units per second",
    );
    assertContains(BANDS, bullet.band, "snapshot().bullets[].band");
    assertContains(
      BANDS,
      bullet.effectiveBand,
      "snapshot().bullets[].effectiveBand (specs/bands.md)",
    );
    assertEqual(
      typeof bullet.friendly,
      "boolean",
      "snapshot().bullets[].friendly, true for one of the player's",
    );
  }

  assertGreaterThan(
    s.bursts.length,
    0,
    "the bursts playing, of which the kill above left one",
  );
  for (const burst of s.bursts) {
    assertEqual(typeof burst.id, "number", "snapshot().bursts[].id");
    assertEqual(typeof burst.x, "number", "snapshot().bursts[].x");
    assertEqual(typeof burst.y, "number", "snapshot().bursts[].y");
    assertEqual(
      typeof burst.size,
      "number",
      "snapshot().bursts[].size, the footprint the effect is played at",
    );
    assertEqual(
      typeof burst.elapsed,
      "number",
      "snapshot().bursts[].elapsed, in seconds into the effect",
    );
    assertEqual(
      typeof burst.particles,
      "number",
      "snapshot().bursts[].particles, the count the burst's own simulation holds",
    );
  }
});
