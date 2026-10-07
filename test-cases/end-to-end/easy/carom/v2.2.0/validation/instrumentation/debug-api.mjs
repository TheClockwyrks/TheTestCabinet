// Automated validation for the Instrumentation sub-item `debug-api`: the build
// installs the whole window.__carom debug and automation surface the specification
// mandates (specs/instrumentation.md).
//
// Every required operation must be present as a function, the handle must carry a
// version, a snapshot must report the full documented shape, and the clock handover
// the surface is built on must actually work. The presence of the operations is read
// through the driver's `api.probe`, which reflects each `typeof` without invoking (and
// mutating through) the operation. A screenshot of a live match is captured as the
// reviewer's proof that the driven game is what was inspected.
//
// This is the one check that verifies the debug API directly; every other automated
// item drives that surface to pose its scenario, so a missing or malformed API also
// shows up as those items failing to run — but this item names the fault plainly.
//
// WHY THE CLOCK IS CHECKED HERE, AND IN `arrange`. `step` and `setAutoStep` are the two
// halves of the contract that makes this surface driveable: `step` takes the wall clock
// away so a scripted scenario is exact, and `setAutoStep(true)` gives it back so the
// game can be watched running. Being installed as functions says nothing about either
// working, and nothing else grades them — a build whose `setAutoStep` is an inert stub
// still answers every scripted item correctly, because the validate pass only ever
// needs `step`, while every recorded clip of the run comes out a frozen frame. That
// failure is invisible to a verdict by construction, so it is checked head-on here.
//
// It has to happen in `arrange`: the two passes deliberately run on different clocks,
// and the runtime sets the flag explicitly once `arrange` returns (see `runPass` in
// `packages/browser-driver/validation.mjs`), so `act` is the one phase where what the
// clock is doing is the runtime's answer rather than the build's. `api.settle` is real
// time in both passes, which is what makes the reading honest in each.
//
// WHY THREE READINGS FOR TWO OPS. Either half of the contract passes VACUOUSLY if the
// clock already happened to be in the state the op is supposed to put it in — and both
// states are reachable before either op is called. Whether a control op leaves the wall
// clock running is the build's choice (see the clock note in specs/instrumentation.md),
// so a build whose `startMatch` held the clock would answer "step stopped it" with a
// clock that was never running, and a build that ignored `reset`'s manual switch would
// answer "setAutoStep started it" with a clock that never stopped. So the readings walk
// the clock through running -> stopped -> running, and each one is graded against a
// state the reading before it established.

import { REQUIRED_DEBUG_OPS, ball0 } from "../_helpers.mjs";

// The window each stage of the clock walk is observed over, in ms of real time.
const CLOCK_MS = 300;
// The floor the clock must clear once it is handed back, in seconds of accumulated
// simulation time. Half the window, matching `gameplay.advances-in-real-time`: the claim
// is that the animation loop drives the tick again, not that it keeps perfect time.
const MIN_HANDED_BACK = CLOCK_MS / 1000 / 2;
// What still counts as "held still" while the build is on its manual clock, in seconds.
// A conformant build advances by exactly nothing; this leaves room for a single frame
// that was already in flight when the manual switch landed, and is still six times
// smaller than the 0.3 s a running clock would report.
const MAX_HELD_STILL = 0.05;

/**
 * Seconds of simulation time the build accumulates over `CLOCK_MS` of REAL time, with
 * nothing driving it. `api.settle` is a genuine wall-clock pause in both passes, so this
 * reads whichever clock the build is currently on rather than the runtime's.
 */
async function elapsedOverWindow(api) {
  const before = await api.snapshot();
  await api.settle(CLOCK_MS);
  return (await api.snapshot()).simTime - before.simTime;
}

export default function item() {
  // The reflected op shape and a live snapshot `act` read, for `assert` to check.
  let shape;
  let snap;
  // The clock walked through running -> stopped -> running, measured in `arrange`
  // (see the header).
  let running;
  let heldStill;
  let handedBack;

  return {
    id: "instrumentation.debug-api",

    // Return to the title, then walk the clock on a live field — stepping "has no effect
    // on a menu screen" (specs/instrumentation.md), so a match has to be running for any
    // of the readings to be observable at all.
    async arrange(api) {
      await api.reset();
      await api.call("startMatch", "versus");
      await api.call("serve");

      // RUNNING. Hand the clock to the animation loop, whatever the ops above left it
      // doing, so that the next reading has a running clock to take away.
      await api.call("setAutoStep", true);
      running = await elapsedOverWindow(api);

      // STOPPED. `step` must take the wall clock back: `api.skip` is the build's own
      // `step` in both passes, so after it real time must move nothing.
      await api.skip(1);
      heldStill = await elapsedOverWindow(api);

      // RUNNING AGAIN, now from a clock that provably stopped — the handover every
      // recorded clip in every run of this case depends on.
      await api.call("setAutoStep", true);
      handedBack = await elapsedOverWindow(api);
    },

    // Reflect the required operations, then drive a real match so the captured
    // screenshot shows the in-game state and the snapshot is read from live play (a
    // ball in flight, so `held` is false and the velocities are non-zero). Probing
    // and reading a snapshot consume no simulation time; the short flight is only so
    // the clip's frame shows motion.
    async act(api) {
      shape = await api.probe(REQUIRED_DEBUG_OPS);
      await api.call("startMatch", "versus");
      await api.call("serve");
      await api.advance(36); // 0.3 s of flight, so the capture shows a live rally
      snap = await api.snapshot();
      await api.screenshot("state");
    },

    async assert(api, check) {
      check.expectEq(
        "the debug handle carries a numeric version",
        typeof shape.version,
        "number",
      );
      for (const op of REQUIRED_DEBUG_OPS) {
        check.expectEq(
          `the debug API installs ${op}() as a function`,
          shape.ops[op],
          "function",
        );
      }

      // The snapshot must report the full documented shape (specs/instrumentation.md).
      check.expectEq(
        "snapshot reports a version",
        typeof snap.version,
        "number",
      );
      check.expectEq(
        "snapshot reports the screen",
        typeof snap.screen,
        "string",
      );
      check.expectEq("snapshot reports the mode", typeof snap.mode, "string");
      check.expectOk(
        "snapshot reports both scores",
        snap.score &&
          typeof snap.score.p1 === "number" &&
          typeof snap.score.p2 === "number",
      );
      check.expectOk("snapshot reports a winner field", "winner" in snap);
      check.expectEq(
        "snapshot reports the mute flag",
        typeof snap.muted,
        "boolean",
      );
      check.expectOk(
        "snapshot reports both paddles' center and velocity",
        snap.paddles &&
          typeof snap.paddles.left.cy === "number" &&
          typeof snap.paddles.left.vy === "number" &&
          typeof snap.paddles.right.cy === "number" &&
          typeof snap.paddles.right.vy === "number",
      );
      // A single-ball build reports one `ball` object; the multi build reports a
      // `balls` array. `ball0` reads ball 0 from either shape.
      const b = ball0(snap);
      check.expectOk(
        "snapshot reports each ball's full state",
        b &&
          ["x", "y", "vx", "vy", "speed", "spin"].every(
            (k) => typeof b[k] === "number",
          ) &&
          typeof b.held === "boolean",
      );
      check.expectEq(
        "snapshot reports the accumulated simulation time",
        typeof snap.simTime,
        "number",
      );

      // The clock contract, measured in `arrange` as running -> stopped -> running. Each
      // reading is graded against the state the one before it established, so none of
      // them can pass on a clock that was already where the op should have put it.
      check.expectGt(
        "under setAutoStep(true) the animation loop advances the simulation (s over 0.3 s of real time)",
        running,
        MIN_HANDED_BACK,
      );
      check.expectLt(
        "...then step() takes the wall clock away, so nothing advances until it is stepped (s)",
        heldStill,
        MAX_HELD_STILL,
      );
      check.expectGt(
        "...and setAutoStep(true) hands the clock back from manual stepping (s)",
        handedBack,
        MIN_HANDED_BACK,
      );
    },
  };
}
