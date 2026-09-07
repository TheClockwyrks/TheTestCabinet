// Volute — instrumentation/debug-surface: the build's game instance returned a
// debug and automation surface from `initialize`, that surface carries every
// operation the specification names as a method, each one really poses or reads
// the running hall, and `snapshot()` reports the whole documented shape with
// values that move when the game is stepped.
//
// WHY THIS ITEM IS THE BROADEST ONE IN THE PROJECT. The surface is the seam every
// other point in this directory poses its scenario through, so a build that
// hollowed it out fails those points too — this one is where the fault is named
// plainly. The engine holds whatever the instance returned and hands it back as
// `engine.debug`, and that read is the only way it reaches a check, so a build
// that returned nothing usable is caught here rather than several frames later.
//
// EVERY THRESHOLD BELOW COMES FROM specs/instrumentation.md, and from that file
// alone:
//
//   "the game instance's `initialize` builds the finished surface and returns
//    it. The engine hands that same object back from `engine.debug`"
//   "The surface carries `version` (`VOLUTE_DEBUG_VERSION`, `1`)"
//   every operation heading under "The operations"          — REQUIRED_OPS
//   "A pose that opens a level takes effect no later than the end of the next
//    advanced frame"                                          — the frame after
//   the `reset` heading's list of title-screen values
//   "the train orders them by descending `s` whatever order the list arrived in"
//   the "Snapshot shape" block, field for field
//   "`simTime` accumulates the elapsed time of every update, whatever the screen"
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. Each operation is checked for the
// effect its OWN heading states and nothing further, so a figure another point
// owns is never spelled here: how far the lead segment advances is
// `channel/feed-advance`, how the feed speed answers pressure is
// `pressure/feed-multiplier`, how long a machinery runs is
// `machinery/machinery-expires`, how many cores a level opens with is
// `channel/seeded-twelve`, and what the cooldown is worth is
// `injector/cooldown-blocks`. A build that gets one of those wrong must fail that
// point and pass this one.
//
// The clock, the keyboard, the pointer and the overlay are NOT on the surface:
// specs/instrumentation.md gives all four to the engine, so asking for any of
// them here would fail a conformant build. Time is moved with `engine.advance`
// and the control points press real keys.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertHasProperty,
  assertLessThan,
  assertNear,
  assertAngleNear,
  assertNotNull,
  assertNull,
  assertEachIn,
  assertLength,
} from "../assert";
import {
  ANGLE_TOL,
  CELLS,
  CHARGE_IDS,
  DEFAULT_SEED,
  INJECTOR_FIELDS,
  MACHINERY_KINDS,
  OPENING_AIM,
  PRESSURE_TOL,
  PROJECTILE_FIELDS,
  REQUIRED_OPS,
  SCREENS,
  SEGMENT_FIELDS,
  SNAPSHOT_FIELDS,
  TICK_DT,
  TICK_TOL,
  TRAIN_FIELDS,
  VOLUTE_DEBUG_VERSION,
} from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  head,
  poseHall,
  seconds,
  spacedBlock,
  startRun,
  type Harness,
  type VoluteSnapshot,
} from "../harness";

/** Ticks stepped where a check only needs the drive to have really moved. */
const DRIVE_TICKS = 30;

/**
 * How far a simulated-time reading may sit from the ticks that produced it.
 *
 * The case's standing tolerance on a duration is +/- 2 ticks, and `simTime`
 * accumulates one tick's `TICK_DT` per tick, so two ticks' worth is the same
 * bound expressed in seconds. It is wide enough for a build that accumulates in
 * milliseconds and narrow enough that a clock running at the wrong rate fails.
 */
const SIM_TIME_TOL = TICK_TOL * TICK_DT;

let h: Harness;

/**
 * Fail with the harness's own account of what is missing, paired with what the
 * specification requires.
 *
 * `assertNull(h.surfaceFault)` would render as "Expected: null" over the reason,
 * throwing away the half of the pair that says what the build owes. This is the
 * point whose whole job is to name that plainly.
 */
function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/* ---- The surface is there -------------------------------------------------- */

it("returns a surface from initialize that the engine hands back", () => {
  // The surface is the build's deliverable: its instance's `initialize` returns
  // it, the engine keeps that same object, and `engine.debug` is the only way it
  // reaches a check. `surfaceFault` is what the harness found when it read it,
  // and it names the missing piece.
  requireSurface();
  const { version } = h.probe([]);
  assertEqual(typeof version, "number", "engine.debug.version");
});

it("carries the documented version and every operation, as functions", () => {
  requireSurface();
  const probed = h.probe(REQUIRED_OPS);

  assertEqual(probed.version, VOLUTE_DEBUG_VERSION, "engine.debug.version");
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `engine.debug.${op}`);
  }
});

/* ---- Each operation poses or reads the running hall ------------------------ */

it("restores every declared field to its title value on reset", async () => {
  // Drive the hall well away from its title values first, so a `reset` that
  // restored nothing cannot pass by accident.
  await startRun(h);
  await poseHall(h, {
    cores: spacedBlock(1000, 4, "cobalt"),
    pressure: 40,
    loaded: "garnet",
    queued: "olivine",
    machinery: "sightline",
  });
  h.debug.setAim(90);
  h.debug.fire();
  await h.step(DRIVE_TICKS);

  h.debug.reset({ seed: DEFAULT_SEED });
  // One frame, and no more: `reset` "Restores every declared field of the game's
  // state to its title-screen value", and a pose that leaves the level "takes
  // effect no later than the end of the next advanced frame"
  // (specs/instrumentation.md). So the values are there by the frame after the
  // call, and a build that restored nothing fails here whatever it deferred.
  const title = await h.step(1);

  assertEqual(title.screen, "title", "the screen a reset leaves");
  assertEqual(title.score, 0, "the score a reset leaves");
  assertEqual(title.level, 1, "the level a reset leaves");
  assertEqual(title.cells, CELLS, "the cells a reset leaves");
  assertLength(title.train, 0, "the cores a reset leaves on the channel");
  assertLength(title.projectiles, 0, "the projectiles a reset leaves");
  assertNear(title.pressure, 0, PRESSURE_TOL, "the pressure a reset leaves");
  assertEqual(title.chainStep, 1, "the chain step a reset leaves");
  assertNull(title.machinery, "the active machinery a reset leaves");
  assertEqual(title.interlude, 0, "the interlude a reset leaves");
  assertNull(title.injector.loaded, "the loaded core a reset leaves");
  assertNull(title.injector.queued, "the queued core a reset leaves");
  assertEqual(title.injector.cooldown, 0, "the cooldown a reset leaves");
  assertAngleNear(
    title.injector.aim,
    OPENING_AIM,
    ANGLE_TOL,
    "the aim a reset leaves",
  );
  // The clock went back to the start, and the one frame advanced since is all
  // that has run on it. A build that reset nothing reads the whole drive above,
  // which is more than thirty times this bound.
  assertNear(
    title.simTime,
    seconds(1),
    SIM_TIME_TOL,
    "the simulated time a reset leaves, one frame on",
  );
});

it("sets the screen, the level, and the run's figures one at a time", async () => {
  h.debug.reset({ seed: DEFAULT_SEED });
  await h.step(1);

  // "Sets the screen to `name` ... and changes nothing else: no level is opened,
  // no channel is seeded, no timer is started". So `playing` on a hall the reset
  // emptied leaves it empty: a build that opened a level here fails.
  h.debug.setScreen("playing");
  const playing = h.snapshot();
  assertEqual(playing.screen, "playing", "the screen setScreen set");
  assertLength(playing.train, 0, "the cores setScreen seeded");
  assertEqual(playing.interlude, 0, "the interlude setScreen started");

  // "Sets the level in play to `level` ... and changes nothing else." Level 3
  // rather than 1, so a build that ignores the argument fails.
  h.debug.setLevel(3);
  const levelled = h.snapshot();
  assertEqual(levelled.level, 3, "the level setLevel set");
  assertEqual(levelled.screen, "playing", "the screen setLevel left");
  assertLength(levelled.train, 0, "the cores setLevel seeded");

  // "`setScore` sets the run's score to `n` ... `setCells` sets the cells
  // remaining to `n` ... Neither ends a run or opens one: `setCells(0)` leaves
  // the screen exactly as it stands."
  h.debug.setScore(1234);
  h.debug.setCells(0);
  const figures = h.snapshot();
  assertEqual(figures.score, 1234, "the score setScore set");
  assertEqual(figures.cells, 0, "the cells setCells set");
  assertEqual(
    figures.screen,
    "playing",
    "the screen setCells(0) left, which ends no run of its own",
  );
  h.debug.setCells(CELLS);

  // "Sets the chain step ... and restarts the window that returns the step to
  // `1`", so both readings move together.
  h.debug.setChainStep(4);
  const chained = h.snapshot();
  assertEqual(chained.chainStep, 4, "the chain step setChainStep set");
  assertGreaterThan(chained.chainTimer, 0, "the window setChainStep restarted");
});

it("opens a level with startLevel, exactly as an interlude opens it", async () => {
  h.debug.reset({ seed: DEFAULT_SEED });
  await h.step(1);
  h.debug.setScore(500);

  // "Opens `level`, a whole number `1` through `LEVEL_COUNT` (`5`)".
  // Level 3 rather than 1, so a build that ignores the argument fails.
  h.debug.startLevel(3);
  const opened = await h.step(1);
  assertEqual(opened.screen, "playing", "the screen startLevel leaves");
  assertEqual(opened.level, 3, "the level startLevel opened");
  assertEqual(opened.chainStep, 1, "the chain step startLevel leaves");
  assertNull(opened.machinery, "the active machinery startLevel leaves");
  assertLength(opened.projectiles, 0, "the projectiles startLevel leaves");
  assertNear(
    opened.pressure,
    0,
    PRESSURE_TOL,
    "the pressure startLevel leaves",
  );
  // "The score and the cells stay as they are."
  assertEqual(opened.score, 500, "the score startLevel leaves");
  assertEqual(opened.cells, CELLS, "the cells startLevel leaves");
  // "The injector draws a fresh loaded and queued core."
  assertNotNull(opened.injector.loaded, "the loaded core startLevel drew");
  assertNotNull(opened.injector.queued, "the queued core startLevel drew");
});

it("holds the inlet and the train, and lets each go again", async () => {
  // A quota that is not exhausted, so the only thing keeping the inlet quiet is
  // its gate, and an empty channel, so an emission is the one way a core can
  // appear. "It is independent of the quota" (specs/instrumentation.md).
  await poseHall(h, {
    level: 1,
    cores: spacedBlock(1000, 2, "halide"),
    feed: false,
  });
  const held = h.snapshot();
  assertEqual(held.emission, false, "snapshot().emission with the inlet held");
  assertEqual(held.feed, false, "snapshot().feed with the train held");

  // Both gates hold across the ticks that follow: nothing arrives at the inlet,
  // and the cores stand exactly where they were posed.
  const stood = await h.step(DRIVE_TICKS);
  assertLength(stood.train, 2, "the cores standing while the inlet is held");
  assertNear(
    head(stood).s,
    head(held).s,
    1e-6,
    "the head's arc position while the train is held",
  );

  // "`setFeed(true)` returns the train to advancing by its own rules." How FAR it
  // advances is `channel/feed-advance`; that it advances at all is this half.
  h.debug.setFeed(true);
  const running = await h.step(DRIVE_TICKS);
  assertEqual(running.feed, true, "snapshot().feed once the train is let go");
  assertGreaterThan(
    head(running).s,
    head(stood).s,
    "the head's arc position once the train is let go",
  );

  // "`setEmission(true)` returns the inlet to emitting by its own rule." The
  // cadence is `channel/emission-cadence`'s point; that the gate lets go is this
  // one's.
  h.debug.setEmission(true);
  const emitting = await h.step(DRIVE_TICKS);
  assertEqual(
    emitting.emission,
    true,
    "snapshot().emission once the inlet is let go",
  );
  assertGreaterThan(
    emitting.train.length,
    stood.train.length,
    "the cores on the channel once the inlet is let go",
  );
});

it("poses the train it is handed, and clears the channel", async () => {
  h.debug.startLevel(1);
  await h.step(1);
  h.debug.setQuotaRemaining(0);
  h.debug.clearTrain();

  // Handed TAIL first, because "the train orders them by descending `s` whatever
  // order the list arrived in" — a build that reports the list back as it arrived
  // fails here.
  h.debug.poseTrain([
    [1000, "halide", null],
    [1120, "sulfur", "sightline"],
    [1240, "cobalt", null],
  ]);
  const posed = h.snapshot();

  assertLength(
    posed.train,
    3,
    "the cores a three-core pose put on the channel",
  );
  const expected = [
    { s: 1240, charge: "cobalt", mark: null },
    { s: 1120, charge: "sulfur", mark: "sightline" },
    { s: 1000, charge: "halide", mark: null },
  ];
  for (const [index, want] of expected.entries()) {
    const core = posed.train[index];
    // "The cores are placed at exactly the arc positions given" — so this is an
    // exact reading of what was handed over rather than a measured figure, and
    // the tolerance is float noise alone.
    assertNear(core.s, want.s, 1e-6, `train[${index}].s`);
    assertEqual(core.charge, want.charge, `train[${index}].charge`);
    assertEqual(core.mark, want.mark, `train[${index}].mark`);
  }

  // "Removes every core from the channel and every projectile."
  h.debug.setAim(270);
  h.debug.fire();
  h.debug.clearTrain();
  const cleared = h.snapshot();
  assertLength(cleared.train, 0, "the cores clearTrain left");
  assertLength(cleared.projectiles, 0, "the projectiles clearTrain left");
});

it("holds the charges it is given and releases the loaded one on fire", async () => {
  await poseHall(h, { loaded: "cobalt", queued: "garnet" });
  const held = h.snapshot();
  assertEqual(held.injector.loaded, "cobalt", "the charge setLoaded set");
  assertEqual(held.injector.queued, "garnet", "the charge setQueued set");

  // "Sets the aim to `angleDegrees`, normalized into `[0, 360)`, and does nothing
  // else": -90 is 270 once normalized, which is what makes this a reading of the
  // normalization rather than of an angle the build echoed back. And "no core is
  // released, the cooldown is untouched", so the hall is unchanged apart from the
  // aim.
  h.debug.setAim(-90);
  const aimed = h.snapshot();
  assertAngleNear(
    aimed.injector.aim,
    OPENING_AIM,
    ANGLE_TOL,
    "the aim setAim(-90) normalized to",
  );
  assertLength(aimed.projectiles, 0, "the projectiles setAim released");
  assertEqual(aimed.injector.loaded, "cobalt", "the charge setAim left loaded");

  // "Releases the loaded core along the current aim through the same path the
  // fire control takes."
  h.debug.fire();
  const fired = h.snapshot();

  // "the core leaves the injector as a projectile, the queued core becomes
  // loaded, a fresh core is drawn as queued, and the cooldown is set as a played
  // shot sets it". What the cooldown is WORTH is `injector/cooldown-blocks`.
  assertGreaterThan(
    fired.projectiles.length,
    0,
    "the projectiles fire() released",
  );
  assertEqual(
    fired.projectiles[0].charge,
    "cobalt",
    "the charge the released core carries",
  );
  assertEqual(fired.injector.loaded, "garnet", "the charge fire() loaded next");
  assertNotNull(fired.injector.queued, "the charge fire() drew as queued");
  assertGreaterThan(fired.injector.cooldown, 0, "the cooldown fire() set");
});

it("sets the pressure and the quota it is given", async () => {
  h.debug.startLevel(1);
  await h.step(1);

  // "Sets the pressure to `value`, `0` through `100`." The game's own clamp is
  // `pressure/clamped-high` and `pressure/clamped-low`; this is the plain read
  // back, at the case's standing pressure tolerance.
  h.debug.setPressure(40);
  assertNear(
    h.snapshot().pressure,
    40,
    PRESSURE_TOL,
    "the pressure setPressure set",
  );

  // "Sets the cores the inlet has left to emit this level to `n`", and
  // "The count of cores emitted this level is the level's quota less what
  // remains". Two settings rather than one, so what is read is the DERIVATION
  // rather than the level's quota figure, which `progression/quota-table` owns:
  // lowering what remains by ten raises what was emitted by exactly ten.
  h.debug.setQuotaRemaining(20);
  const wide = h.snapshot();
  assertEqual(wide.quotaRemaining, 20, "the quota setQuotaRemaining set");

  h.debug.setQuotaRemaining(10);
  const narrow = h.snapshot();
  assertEqual(narrow.quotaRemaining, 10, "the quota setQuotaRemaining set");
  assertEqual(
    narrow.emitted - wide.emitted,
    10,
    "the rise in emitted when ten fewer cores remain",
  );
});

it("grants the machinery it names, and pauses and resumes the hall", async () => {
  await poseHall(h, { cores: spacedBlock(1000, 3, "halide") });

  // "`choke`, `backflow`, and `sightline` become the active machinery at their
  // full duration". How LONG that duration is belongs to
  // `machinery/machinery-expires`; that a grant is in force at all is this
  // point's half.
  h.debug.grantMachinery("sightline");
  const granted = h.snapshot();
  assertNotNull(granted.machinery, "the machinery grantMachinery left active");
  assertEqual(
    granted.machinery?.kind,
    "sightline",
    "the kind grantMachinery granted",
  );
  assertGreaterThan(
    granted.machinery?.remaining ?? 0,
    0,
    "the seconds left on the granted machinery",
  );

  // "`pause` poses the pause control, moving the screen to `paused`; `resume`
  // poses it again, returning the screen to `playing`."
  h.debug.pause();
  assertEqual(h.snapshot().screen, "paused", "the screen pause() left");
  h.debug.resume();
  assertEqual(h.snapshot().screen, "playing", "the screen resume() left");
});

/* ---- The snapshot ---------------------------------------------------------- */

it("reports the whole documented snapshot shape, from a live hall", async () => {
  // A hall holding one of everything the shape names, so no branch of the block
  // is read off an empty list: cores on the channel in two segments, a projectile
  // in flight, a machinery in force, and a pressure that is not the opening 0.
  await startRun(h);
  await poseHall(h, {
    cores: [
      ...spacedBlock(1200, 3, "halide"),
      ...spacedBlock(900, 2, "sulfur"),
    ],
    pressure: 30,
    loaded: "cobalt",
    queued: "garnet",
    machinery: "sightline",
  });
  h.debug.setAim(270);
  h.debug.fire();
  await h.step(2);

  // The frame the snapshot below is read off: what the surface reports and what
  // the build drew, at the same instant, so a reviewer can hold the two against
  // each other.
  captureStill(h, "state");

  const s = h.snapshot();

  // Every field of the block is present, whatever the screen.
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(s, field, "snapshot()");
  }

  assertEqual(s.version, VOLUTE_DEBUG_VERSION, "snapshot().version");
  assertContains(SCREENS, s.screen, "snapshot().screen");
  for (const field of [
    "score",
    "level",
    "cells",
    "quotaRemaining",
    "emitted",
    "pressure",
    "feedSpeed",
    "chainStep",
    "chainTimer",
    "interlude",
    "simTime",
    "rngState",
  ] as const) {
    assertEqual(typeof s[field], "number", `snapshot().${field}`);
  }
  assertEqual(typeof s.danger, "boolean", "snapshot().danger");
  assertEqual(typeof s.muted, "boolean", "snapshot().muted");

  // The train, head first, with every documented field on every entry.
  assertGreaterThan(s.train.length, 0, "the cores snapshot() reports");
  for (const [index, core] of s.train.entries()) {
    for (const field of TRAIN_FIELDS) {
      assertHasProperty(core, field, `snapshot().train[${index}]`);
    }
    assertEqual(typeof core.s, "number", `snapshot().train[${index}].s`);
    assertEqual(typeof core.x, "number", `snapshot().train[${index}].x`);
    assertEqual(typeof core.y, "number", `snapshot().train[${index}].y`);
    assertContains(
      CHARGE_IDS,
      core.charge,
      `snapshot().train[${index}].charge`,
    );
    if (core.mark !== null) {
      assertContains(
        MACHINERY_KINDS,
        core.mark,
        `snapshot().train[${index}].mark`,
      );
    }
    assertEqual(
      typeof core.segment,
      "number",
      `snapshot().train[${index}].segment`,
    );
  }
  // "head first": the arc positions fall from the head toward the tail.
  for (let i = 1; i < s.train.length; i += 1) {
    assertLessThan(
      s.train[i].s,
      s.train[i - 1].s,
      `snapshot().train[${i}].s against the core ahead of it`,
    );
  }
  // "`0` is the lead segment, rising toward the tail."
  assertEqual(s.train[0].segment, 0, "the segment the head belongs to");

  // The segments, head first.
  assertGreaterThan(s.segments.length, 0, "the segments snapshot() reports");
  for (const [index, segment] of s.segments.entries()) {
    for (const field of SEGMENT_FIELDS) {
      assertHasProperty(segment, field, `snapshot().segments[${index}]`);
    }
    assertEqual(
      typeof segment.count,
      "number",
      `snapshot().segments[${index}].count`,
    );
    assertEqual(
      typeof segment.hold,
      "number",
      `snapshot().segments[${index}].hold`,
    );
  }
  // "`segments[].count` | How many cores the segment holds" — so the counts add
  // up to the train, and every core names a segment the list holds.
  assertEqual(
    s.segments.reduce((total, segment) => total + segment.count, 0),
    s.train.length,
    "the cores the segments account for",
  );
  assertEachIn(
    s.train.map((core) => core.segment),
    s.segments.map((_, index) => index),
    "the segment every core names",
  );

  // The injector.
  for (const field of INJECTOR_FIELDS) {
    assertHasProperty(s.injector, field, "snapshot().injector");
  }
  assertEqual(typeof s.injector.aim, "number", "snapshot().injector.aim");
  assertEqual(
    typeof s.injector.cooldown,
    "number",
    "snapshot().injector.cooldown",
  );
  assertContains(CHARGE_IDS, s.injector.loaded, "snapshot().injector.loaded");
  assertContains(CHARGE_IDS, s.injector.queued, "snapshot().injector.queued");

  // The projectiles.
  assertGreaterThan(
    s.projectiles.length,
    0,
    "the projectiles snapshot() reports",
  );
  for (const [index, shot] of s.projectiles.entries()) {
    for (const field of PROJECTILE_FIELDS) {
      assertHasProperty(shot, field, `snapshot().projectiles[${index}]`);
    }
    assertEqual(typeof shot.x, "number", `snapshot().projectiles[${index}].x`);
    assertEqual(typeof shot.y, "number", `snapshot().projectiles[${index}].y`);
    assertEqual(
      typeof shot.angle,
      "number",
      `snapshot().projectiles[${index}].angle`,
    );
    assertContains(
      CHARGE_IDS,
      shot.charge,
      `snapshot().projectiles[${index}].charge`,
    );
  }

  // The machinery in force.
  assertNotNull(s.machinery, "snapshot().machinery");
  assertContains(
    MACHINERY_KINDS,
    s.machinery?.kind,
    "snapshot().machinery.kind",
  );
  assertEqual(
    typeof s.machinery?.remaining,
    "number",
    "snapshot().machinery.remaining",
  );

  // Live values rather than a shape filled with zeroes.
  assertEqual(s.screen, "playing", "the screen the posed hall is on");
  // Above the opening 0 rather than exactly the posed 30: two ticks of bleed have
  // run since the pose ("bleed = 2.0 when coreCount <= 24", specs/channel.md), and
  // what that rate is worth is `pressure/bleed`'s point. The read-back of
  // `setPressure` itself is asserted before any tick runs, above.
  assertGreaterThan(s.pressure, 0, "the pressure the posed hall reports");
  assertGreaterThan(s.simTime, 0, "the simulated time the drive accumulated");
});

it("reports values that move when the hall is stepped", async () => {
  await startRun(h);
  await poseHall(h, {
    cores: spacedBlock(1000, 3, "halide"),
    machinery: "sightline",
  });
  h.debug.setAim(270);
  h.debug.fire();
  const before = h.snapshot();

  const after = await h.step(DRIVE_TICKS);

  // Each of these is a value the specification has falling or rising with the
  // ticks, read as a DIRECTION rather than as a figure another point owns.
  assertNear(
    after.simTime - before.simTime,
    seconds(DRIVE_TICKS),
    SIM_TIME_TOL,
    `the simulated seconds ${DRIVE_TICKS} ticks covered`,
  );
  assertGreaterThan(
    head(after).s,
    head(before).s,
    "the head's arc position after the hall was stepped",
  );
  assertLessThan(
    after.machinery?.remaining ?? Number.POSITIVE_INFINITY,
    before.machinery?.remaining ?? 0,
    "the seconds left on the machinery after the hall was stepped",
  );
  // The projectile "advances along its heading" every tick, so wherever it is —
  // still flying, seated, or gone — it is no longer where it was released.
  const moved = movedOrResolved(before, after);
  assertEqual(moved, true, "the projectile after the hall was stepped");
});

/** Whether the shot `before` reported has flown, seated, or left the field. */
function movedOrResolved(
  before: VoluteSnapshot,
  after: VoluteSnapshot,
): boolean {
  const first = before.projectiles[0];
  const still = after.projectiles[0];
  if (first === undefined) return false;
  if (still === undefined) return true;
  return still.x !== first.x || still.y !== first.y;
}
