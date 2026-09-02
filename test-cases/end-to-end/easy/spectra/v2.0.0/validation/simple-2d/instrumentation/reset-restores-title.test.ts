// instrumentation/reset-restores-title — `reset()` gives the whole game back.
//
// specs/instrumentation.md lists what it restores, and this point is that list:
// "`reset` restores `screen` to `"title"`, `phase` to `"live"`, `phaseTimer` to
// `0`, `menuIndex` to `0`, `score` to `0`, `lives` to `START_LIVES` (`3`),
// `stage` to `1`, `resonance` to `0`, and `inversion` to `0`; it empties the
// drone, bullet, and burst rosters and the live discharge; it places the ship at
// the center of its lane (`640`) on the cyan band with `0` seconds of fire
// lockout and `0` seconds of fire cooldown; it turns the three world gates
// `waveEntry`, `diveLaunching`, and `ship.contact` back on; it returns the wave's
// entry, sway, and dive clocks, and the gap the next dive waits for, to their
// fresh-wave values, `diveClock` at `0` and the gap at `DIVE_FIRST_DELAY`; it
// sets `extraLifeAwarded` to `false` and the challenge-stage hit count to `0`;
// and it sets `simTime` to `0` and the counter the next entity's id is taken from
// back to the first id".
//
// THE RUN IS MADE MESSY FIRST, AND EVERY FIELD IS MOVED OFF ITS TITLE VALUE
// BEFORE THE RESET. A reset read off a game that was already at its title values
// decides nothing: each figure below is posed to something the title state cannot
// hold, so a build that restores none of them, or restores only the ones it
// happens to rebuild, reads as the field it left behind.
//
// THE DISCHARGE IS LIT BEFORE THE RESET, TOO. "It empties … the live discharge"
// is one of the fields on that list, and a reset read off a game with no wave
// running decides nothing about it: the meter is filled and the key held until
// `discharge.active` reads true, and the check says so as a precondition before
// it asks what the reset left. The wave is lit BEFORE the figures below are
// posed, because lighting it costs frames and spends the meter, and no frame runs
// between the last pose and the reset — so the radius the wave reached in those
// few frames is a fraction of `DISCHARGE_RADIUS` and it takes nothing off the
// field this point needs standing.
//
// MUTE IS THE ONE THING RESET MAY NOT TOUCH: "`muted` is left exactly as it
// stands, because muting is a player preference the runtime owns." So it is
// turned on through its real binding — there is no `setMuted`
// (specs/instrumentation.md) — and read back after the reset.
//
// THE ID COUNTER IS READ THE ONLY WAY IT CAN BE. It is not a snapshot field, so
// what is compared is the id the FIRST entity of a fresh game took against the id
// the first entity added after the reset takes: "so two runs reset with the same
// seed report the same ids for the same scenario".
//
// WHAT THIS DOES NOT DECIDE. What `reset({ seed })` does to the game's
// randomness, which is `instrumentation/reset-seeds-randomness`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, RESONANCE_MAX, START_LIVES } from "../../src/constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  lastDrone,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseBursts } from "./bursts";

/** The tolerance a restored figure is read at: half a millionth of a unit, which
 * is a round trip through a float and nothing else. */
const EXACT_DIGITS = 6;

/** The figures the run is posed to before the reset, each impossible at the
 * title: a score, one life fewer than a run starts with, a later stage, a part
 * meter, a live inversion, and a dive clock that has run. */
const MESSY_SCORE = 8400;
const MESSY_LIVES = START_LIVES - 1;
const MESSY_STAGE = 5;
const MESSY_RESONANCE = 42;
const MESSY_INVERSION = 3.5;
const MESSY_PHASE_TIMER = 0.9;
const MESSY_MENU_INDEX = 2;
const MESSY_DIVE_CLOCK = 1.75;

/** The ship, posed off the centre of its lane, off its opening band, and with
 * both of its cannon's timers running. */
const MESSY_SHIP_X = 220;
const MESSY_LOCKOUT = 0.25;
const MESSY_COOLDOWN = 0.11;

/** Where the drones stand while the run is made messy. Geometry only: both are
 * well inside the play field (specs/field.md). */
const DRONE_Y = 240;
const SHARD_X = 500;
const PRISM_X = 780;

/** Where the two bullets are placed while the run is made messy. */
const BULLET_X = 640;
const PLAYER_BULLET_Y = 500;
const ENEMY_BULLET_Y = 160;

/** How many bursts stand on the field before the reset. */
const BURSTS = 2;

/**
 * Frames the discharge is given to go live after the key goes down.
 *
 * A tenth of a second. specs/resonance.md fires the wave on the press with the
 * meter full, so a conformant build has it running on the first frame; the window
 * is the room a build gets to raise it on the frame after, and it is short enough
 * that the wave's radius when the reset lands is a fraction of its full reach.
 */
const RELEASE_TICKS = ticksFor(0.1);

/** Where the probe drone that reads the id counter is placed. */
const PROBE_X = 640;
const PROBE_Y = 300;

/** The first key specs/controls.md binds the `mute` action to. */
const MUTE_KEY = BINDINGS.mute[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every declared field to its title value, and leaves mute alone", async () => {
  // The id the FIRST entity of a fresh game takes, read before anything else has
  // happened, and then taken back off the field.
  h.debug.addDrone("shard", PROBE_X, PROBE_Y);
  const firstId = lastDrone(h.snapshot()).id;
  h.debug.clearDrones();

  // Mute, through its real binding: there is no operation that sets it.
  h.hold(MUTE_KEY);
  await h.advance(1);
  h.release(MUTE_KEY);
  await h.advance(1);
  const muted = h.snapshot().muted;
  assertEqual(
    muted,
    true,
    `the mute bit after the ${String(MUTE_KEY)} key was pressed, which is the ` +
      "only way it is reached (specs/controls.md, specs/instrumentation.md)",
  );

  // A messy run: a live wave, drones, bullets, bursts, and every figure moved
  // off the value the title holds.
  startPosed(h);
  const burstIds = await poseBursts(h, BURSTS);
  poseDrone(h, "shard", SHARD_X, DRONE_Y, { band: "magenta" });
  poseDrone(h, "prism", PRISM_X, DRONE_Y, { shell: false });
  h.debug.addPlayerBullet(BULLET_X, PLAYER_BULLET_Y, "cyan");
  h.debug.addEnemyBullet(BULLET_X, ENEMY_BULLET_Y, "magenta");

  // The live wave, lit before the figures below because it costs frames and
  // spends the meter. Nothing runs between the last pose and the reset, so the
  // radius it reached here is what stands when the reset lands.
  h.debug.setResonance(RESONANCE_MAX);
  h.hold(BINDINGS.discharge[0]);
  const fired = await h.until((state) => state.discharge.active, {
    maxFrames: RELEASE_TICKS,
  });
  h.release(BINDINGS.discharge[0]);
  assertTrue(
    fired.hit,
    `a discharge wave live within ${String(RELEASE_TICKS)} frames of the ` +
      `${String(BINDINGS.discharge[0])} key going down with the meter at ` +
      `RESONANCE_MAX (${String(RESONANCE_MAX)}) (specs/resonance.md) — this ` +
      "point cannot hold reset to emptying a wave that never ran",
  );

  h.debug.setScore(MESSY_SCORE);
  h.debug.setLives(MESSY_LIVES);
  h.debug.setStage(MESSY_STAGE);
  h.debug.setExtraLifeAwarded(true);
  h.debug.setMenuIndex(MESSY_MENU_INDEX);
  h.debug.setPhase("ready");
  h.debug.setPhaseTimer(MESSY_PHASE_TIMER);
  h.debug.setResonance(MESSY_RESONANCE);
  h.debug.setInversion(MESSY_INVERSION);
  h.debug.setShipX(MESSY_SHIP_X);
  h.debug.setShipBand("magenta");
  h.debug.setFireLockout(MESSY_LOCKOUT);
  h.debug.setFireCooldown(MESSY_COOLDOWN);
  h.debug.setDiveClock(MESSY_DIVE_CLOCK);
  // `startPosed` shut all three world gates, which is the state a reset has to
  // turn back on.

  const messy = h.snapshot();
  assertLength(messy.bursts, BURSTS, "the bursts standing before the reset");
  assertEqual(messy.bursts[0]?.id, burstIds[0], "the first burst posed");
  assertGreaterThan(
    messy.drones.length,
    0,
    "the drones standing before the reset, which it empties",
  );
  assertGreaterThan(
    messy.bullets.length,
    0,
    "the bullets in flight before the reset, which it empties",
  );
  assertEqual(
    messy.discharge.active,
    true,
    "the wave still live at the moment of the reset, which it empties " +
      "(specs/resonance.md, specs/instrumentation.md)",
  );
  assertTrue(
    messy.simTime > 0,
    "simulation time accumulated while the run was posed, so the reset has " +
      "something to put back (specs/simulation.md)",
  );

  h.debug.reset();
  const title = h.snapshot();

  // The picture, drawn afterwards: a still is evidence, never a verdict, so the
  // frame that paints the restored title screen runs after the reading above.
  await h.advance(1);
  captureStill(h, "title");

  // The screen and the run.
  assertEqual(title.screen, "title", "reset restores screen");
  assertEqual(title.phase, "live", "reset restores phase");
  assertCloseTo(title.phaseTimer, 0, EXACT_DIGITS, "reset restores phaseTimer");
  assertEqual(title.menuIndex, 0, "reset restores menuIndex");
  assertEqual(title.score, 0, "reset restores score");
  assertEqual(title.lives, START_LIVES, "reset restores lives to START_LIVES");
  assertEqual(title.stage, 1, "reset restores stage");
  assertEqual(title.extraLifeAwarded, false, "reset clears extraLifeAwarded");

  // The band systems.
  assertCloseTo(title.resonance, 0, EXACT_DIGITS, "reset restores resonance");
  assertCloseTo(title.inversion, 0, EXACT_DIGITS, "reset restores inversion");

  // The field.
  assertLength(title.drones, 0, "reset empties the drone roster");
  assertLength(title.bullets, 0, "reset empties the bullet roster");
  assertLength(title.bursts, 0, "reset empties the burst roster");
  assertEqual(
    title.discharge.active,
    false,
    "reset empties the live discharge",
  );
  assertCloseTo(
    title.discharge.radius,
    0,
    EXACT_DIGITS,
    "reset empties the live discharge",
  );

  // The ship.
  assertCloseTo(
    title.ship.x,
    LANE_CENTER,
    EXACT_DIGITS,
    "reset places the ship at the centre of its lane",
  );
  assertEqual(title.ship.band, "cyan", "reset puts the ship back on cyan");
  assertCloseTo(
    title.ship.lockout,
    0,
    EXACT_DIGITS,
    "reset clears the fire lockout",
  );
  assertCloseTo(
    title.ship.cooldown,
    0,
    EXACT_DIGITS,
    "reset clears the fire cooldown",
  );

  // The world gates and the wave's own clock.
  assertEqual(title.waveEntry, true, "reset turns waveEntry back on");
  assertEqual(title.diveLaunching, true, "reset turns diveLaunching back on");
  assertEqual(title.ship.contact, true, "reset turns ship.contact back on");
  assertCloseTo(title.diveClock, 0, EXACT_DIGITS, "reset restores diveClock");

  // The rest.
  assertCloseTo(title.simTime, 0, EXACT_DIGITS, "reset restores simTime");
  assertEqual(
    title.muted,
    muted,
    "reset leaves muted exactly as it stands, because muting is a player " +
      "preference the runtime owns (specs/instrumentation.md)",
  );

  // The id counter, read the only way it can be: the first entity added after a
  // reset takes the id the first entity of a fresh game took.
  h.debug.addDrone("shard", PROBE_X, PROBE_Y);
  assertEqual(
    lastDrone(h.snapshot()).id,
    firstId,
    "the id the first entity added after a reset takes, against the id the " +
      "first entity of a fresh game took — reset puts the counter the next " +
      "entity's id is taken from back to the first id " +
      "(specs/instrumentation.md)",
  );
});
