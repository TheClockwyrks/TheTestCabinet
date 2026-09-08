// Volute — instrumentation/debug-surface: the build returned the debug and
// automation surface beside its state, that surface carries every operation the
// specification names as a function, each one really poses or reads the running
// hall, and `snapshot()` reports the whole documented shape with values that move
// when the game is stepped.
//
// WHY THIS ITEM IS THE BROADEST ONE IN THE PROJECT. Every other point in this
// directory poses its scenario through the same surface, so a build that hollowed
// it out fails those points too — this one is where the fault is named plainly.
// The surface is the build's own deliverable: `specs/instrumentation.md` has its
// `initialize` return "the finished surface beside the state it built, as the
// pair `[state, debug]`", the engine holds that second element, and
// `engine.debug` is the whole route to it.
//
// EVERY THRESHOLD BELOW COMES FROM specs/instrumentation.md, and from that file
// alone:
//
//   "the build's `initialize` returns the finished surface beside the state it
//    built, as the pair `[state, debug]`. The engine returns that same value from
//    `engine.debug`"                                          — the surface
//   "The surface carries `version` (`VOLUTE_DEBUG_VERSION`, `1`)"
//   every operation heading under "The operations"           — REQUIRED_OPS
//   "Render-free core. Game state advances from ticks and input alone,
//    independent of the canvas, of the frame loop that measured the delta time,
//    and of wall-clock time"                                  — the clock
//   "The engine advances the game frame by frame and a clock that supplies its
//    own deltas takes it off real time, so a scenario pairs a `ConstantClock` of
//    `1000 / 60` milliseconds with `engine.advance` and steps exactly one
//    simulation step per frame"
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
// THE CLOCK, THE KEYBOARD, THE POINTER AND THE OVERLAY ARE NOT ON THE SURFACE.
// "The Simple 2D engine owns the clock, the keyboard, the pointer, and the
// overlay ... so the surface carries no operation for any of them." The
// engineless surface carries two clock operations, `setAutoStep` and `step`, and
// asking for either here would fail a build that implemented exactly what its own
// specification asked for. What IS read instead is the property those two exist to
// give a caller: the hall advances from its ticks alone, so real time passing
// moves nothing and an advanced frame moves it by exactly one tick.

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
  HANDLE,
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
  fireAt,
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

it(`returns its surface beside its state, as ${HANDLE}`, async () => {
  // The build wrote the surface and returned it from `initialize`, and either the
  // engine is holding it or nothing in this directory can reach the game.
  // `surfaceFault` is what the harness found when it looked, and it names the
  // missing piece.
  requireSurface();
  const { version } = await h.probe([]);
  assertEqual(typeof version, "number", `${HANDLE}.version`);
});

it("carries the documented version and every operation, as functions", async () => {
  requireSurface();
  const probed = await h.probe(REQUIRED_OPS);

  assertEqual(probed.version, VOLUTE_DEBUG_VERSION, `${HANDLE}.version`);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `${HANDLE}.${op}`);
  }
});

/* ---- The clock the engine owns --------------------------------------------- */

it("advances exactly one tick per advanced frame", async () => {
  // An advanced frame is exactly one tick: the harness's `ConstantClock` of
  // `1000 / 60` ms is the step specs/instrumentation.md names, so the game's own
  // accumulated simulation time moves by exactly the time those ticks cover, and
  // the train it carries moves with it. Nothing here waits on real time: a
  // stretch of the wall clock decides nothing about the build, and the rule that
  // the state "advances from ticks and input alone" is read through what the
  // counted frames did.
  await startRun(h);
  await poseHall(h, { cores: spacedBlock(1000, 3, "halide") });
  const posed = await h.snapshot();

  const driven = await h.step(DRIVE_TICKS);
  assertNear(
    driven.simTime - posed.simTime,
    seconds(DRIVE_TICKS),
    SIM_TIME_TOL,
    `the simulated seconds ${DRIVE_TICKS} ticks covered`,
  );
  assertGreaterThan(
    head(driven).s,
    head(posed).s,
    `the head's arc position after ${DRIVE_TICKS} advanced frames`,
  );
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
  await fireAt(h, 90);
  await h.step(DRIVE_TICKS);

  await h.debug.setNextEmitted("sulfur");
  await h.debug.reset();
  const title = await h.snapshot();

  // Read without stepping: `reset` "Restores every declared field of the game's
  // state to its title-screen value", so the values are there at the call.
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
  assertNull(title.nextEmitted, "the posed emission charge a reset leaves");
  assertEqual(title.injector.cooldown, 0, "the cooldown a reset leaves");
  assertAngleNear(
    title.injector.aim,
    OPENING_AIM,
    ANGLE_TOL,
    "the aim a reset leaves",
  );
  // Within a tick of zero rather than exactly zero: a build that accumulates its
  // simulated time in milliseconds and reports seconds lands on a float, and the
  // requirement is that the clock went back to the start rather than that it
  // landed on a particular representation of it.
  assertNear(title.simTime, 0, TICK_DT, "the simulated time a reset leaves");

  // "The inlet's gate and the train's gate are untouched": `poseHall` held the
  // inlet, and a reset inside a posed scenario leaves it held, so a scenario
  // that resets mid-drive stays the scenario it was.
  assertEqual(title.emission, false, "the inlet's gate a reset leaves");
  assertEqual(title.feed, true, "the train's gate a reset leaves");
});

it("poses the screen, the level, the score, the cells and the chain one at a time", async () => {
  await h.debug.reset();

  // Each of these "changes nothing else", so each is read back on its own and
  // the fields the others own are read back unchanged beside it.
  await h.debug.setScreen("paused");
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen setScreen set",
  );

  await h.debug.setLevel(4);
  const levelled = await h.snapshot();
  assertEqual(levelled.level, 4, "the level setLevel set");
  assertEqual(levelled.screen, "paused", "the screen setLevel left alone");
  assertLength(levelled.train, 0, "the cores setLevel put on the channel");

  await h.debug.setScore(1230);
  assertEqual((await h.snapshot()).score, 1230, "the score setScore set");

  await h.debug.setCells(1);
  const spent = await h.snapshot();
  assertEqual(spent.cells, 1, "the cells setCells set");
  // "Neither ends a run or opens one": the screen is where setScreen left it.
  assertEqual(spent.screen, "paused", "the screen setCells left alone");

  await h.debug.setChainStep(3);
  const chained = await h.snapshot();
  assertEqual(chained.chainStep, 3, "the chain step setChainStep set");
  // "restarts the window that returns the step to `1`", so the window is open.
  assertGreaterThan(
    chained.chainTimer,
    0,
    "the chain window setChainStep left",
  );
});

it("holds the inlet and the train with the driver's two gates", async () => {
  // Both gates are read back the way every other field is: set a value, read it.
  await h.debug.reset();
  await h.debug.setEmission(false);
  await h.debug.setFeed(false);
  const held = await h.snapshot();
  assertEqual(held.emission, false, "the inlet's gate setEmission set");
  assertEqual(held.feed, false, "the train's gate setFeed set");

  // With the train held, "no core's arc position changes there": the cores this
  // poses stand where they were posed however long the hall runs. How FAR they
  // would otherwise travel is `channel/feed-advance`'s point.
  await h.debug.setScreen("playing");
  await h.debug.poseTrain(spacedBlock(1000, 3, "halide"));
  const posed = await h.snapshot();
  const stepped = await h.step(DRIVE_TICKS);
  assertNear(
    head(stepped).s,
    head(posed).s,
    1e-6,
    `the head's arc position after ${DRIVE_TICKS} ticks with the train held`,
  );
  // And with the inlet held, nothing arrives however much quota remains.
  assertGreaterThan(stepped.quotaRemaining, 0, "the quota left to emit");
  assertLength(
    stepped.train,
    3,
    "the cores on a channel the inlet is held over",
  );

  // Let both go, and the hall runs again.
  await h.debug.setEmission(true);
  await h.debug.setFeed(true);
  const running = await h.step(DRIVE_TICKS);
  assertEqual(running.emission, true, "the inlet's gate setEmission set");
  assertEqual(running.feed, true, "the train's gate setFeed set");
  assertGreaterThan(
    head(running).s,
    head(stepped).s,
    "the head's arc position once the train was let go",
  );
});

it("opens a named level with startLevel", async () => {
  await h.debug.reset();

  // "Opens `level`, a whole number `1` through `LEVEL_COUNT` (`5`)".
  // Level 3 rather than 1, so a build that ignores the argument fails.
  await h.debug.startLevel(3);
  const opened = await h.snapshot();
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
  // "The injector draws a fresh loaded and queued core."
  assertNotNull(opened.injector.loaded, "the loaded core startLevel drew");
  assertNotNull(opened.injector.queued, "the queued core startLevel drew");
});

it("poses the train it is handed, and clears the channel", async () => {
  await h.debug.startLevel(1);
  await h.debug.setQuotaRemaining(0);
  await h.debug.clearTrain();

  // Handed TAIL first, because "the train orders them by descending `s` whatever
  // order the list arrived in" — a build that reports the list back as it arrived
  // fails here.
  await h.debug.poseTrain([
    [1000, "halide", null],
    [1120, "sulfur", "sightline"],
    [1240, "cobalt", null],
  ]);
  const posed = await h.snapshot();

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
  await fireAt(h, 270);
  await h.debug.clearTrain();
  const cleared = await h.snapshot();
  assertLength(cleared.train, 0, "the cores clearTrain left");
  assertLength(cleared.projectiles, 0, "the projectiles clearTrain left");
});

it("holds the charges it is given and releases the loaded one on fire", async () => {
  await poseHall(h, { loaded: "cobalt", queued: "garnet" });
  const held = await h.snapshot();
  assertEqual(held.injector.loaded, "cobalt", "the charge setLoaded set");
  assertEqual(held.injector.queued, "garnet", "the charge setQueued set");

  // "The snapshot reports the pose as `nextEmitted`, and `null` while none
  // stands": the read-back of the pose alone. What the inlet then emits under it
  // is `instrumentation/set-next-emitted-poses-the-charge`.
  await h.debug.setNextEmitted("sulfur");
  assertEqual(
    (await h.snapshot()).nextEmitted,
    "sulfur",
    "the charge setNextEmitted posed",
  );
  await h.debug.setNextEmitted(null);
  assertNull(
    (await h.snapshot()).nextEmitted,
    "the pose setNextEmitted(null) cleared",
  );

  // "Sets the aim to `angleDegrees`, normalized into `[0, 360)`, and does nothing
  // else": -90 is 270 once normalized, which is what makes this a reading of the
  // normalization rather than of an angle the build echoed back. Nothing is
  // released by it, which is the other half of the heading.
  await h.debug.setAim(-90);
  const aimed = await h.snapshot();
  assertAngleNear(
    aimed.injector.aim,
    OPENING_AIM,
    ANGLE_TOL,
    "the aim setAim(-90) normalized to",
  );
  assertLength(aimed.projectiles, 0, "the projectiles setAim released");
  assertEqual(aimed.injector.loaded, "cobalt", "the charge setAim left loaded");

  await h.debug.fire();
  const fired = await h.snapshot();
  assertAngleNear(
    fired.injector.aim,
    OPENING_AIM,
    ANGLE_TOL,
    "the aim fire() left the injector on",
  );

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
  await h.debug.startLevel(1);

  // "Sets the pressure to `value`, `0` through `100`." The game's own clamp is
  // `pressure/clamped-high` and `pressure/clamped-low`; this is the plain read
  // back, at the case's standing pressure tolerance.
  await h.debug.setPressure(40);
  assertNear(
    (await h.snapshot()).pressure,
    40,
    PRESSURE_TOL,
    "the pressure setPressure set",
  );

  // "Sets the cores the inlet has left to emit this level to `n`", and
  // "The count of cores emitted this level is the level's quota less what
  // remains". Two settings rather than one, so what is read is the DERIVATION
  // rather than the level's quota figure, which `progression/quota-table` owns:
  // lowering what remains by ten raises what was emitted by exactly ten.
  await h.debug.setQuotaRemaining(20);
  const wide = await h.snapshot();
  assertEqual(wide.quotaRemaining, 20, "the quota setQuotaRemaining set");

  await h.debug.setQuotaRemaining(10);
  const narrow = await h.snapshot();
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
  await h.debug.grantMachinery("sightline");
  const granted = await h.snapshot();
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
  await h.debug.pause();
  assertEqual((await h.snapshot()).screen, "paused", "the screen pause() left");
  await h.debug.resume();
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen resume() left",
  );
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
  await fireAt(h, 270);
  await h.step(2);

  // The frame the snapshot below is read off: what the surface reports and what
  // the build drew, at the same instant, so a reviewer can hold the two against
  // each other.
  await captureStill(h, "state");

  const s = await h.snapshot();

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
  ] as const) {
    assertEqual(typeof s[field], "number", `snapshot().${field}`);
  }
  assertEqual(typeof s.danger, "boolean", "snapshot().danger");
  assertEqual(typeof s.emission, "boolean", "snapshot().emission");
  assertEqual(typeof s.feed, "boolean", "snapshot().feed");
  assertEqual(typeof s.muted, "boolean", "snapshot().muted");
  // A charge id while a pose stands, and `null` otherwise.
  assertContains(
    [...CHARGE_IDS, null],
    s.nextEmitted,
    "snapshot().nextEmitted",
  );

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
  await fireAt(h, 270);
  const before = await h.snapshot();

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
