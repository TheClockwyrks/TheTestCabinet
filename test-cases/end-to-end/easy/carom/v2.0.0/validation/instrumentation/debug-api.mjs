// Automated validation for the Instrumentation sub-item `debug-api`: the build
// installs the whole window.__carom debug and automation surface the specification
// mandates (specs/instrumentation.md).
//
// Every required operation must be present as a function, the handle must carry a
// version, and a snapshot must report the full documented shape. The presence of the
// operations is read through the driver's `api.probe`, which reflects each `typeof`
// without invoking (and mutating through) the operation. A screenshot of a live match
// is captured as the reviewer's proof that the driven game is what was inspected.
//
// This is the one check that verifies the debug API directly; every other automated
// item drives that surface to pose its scenario, so a missing or malformed API also
// shows up as those items failing to run — but this item names the fault plainly.

import { REQUIRED_DEBUG_OPS } from "../_helpers.mjs";

export default function item() {
  // The reflected op shape and a live snapshot `act` read, for `assert` to check.
  let shape;
  let snap;

  return {
    id: "instrumentation.debug-api",

    // Return to the title, from where the surface is inspected.
    async arrange(api) {
      await api.reset();
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
      const b = Array.isArray(snap.balls) ? snap.balls[0] : null;
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
    },
  };
}
