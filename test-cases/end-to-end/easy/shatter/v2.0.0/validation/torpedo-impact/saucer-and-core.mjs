// Automated validation (Warhead) for the Torpedo-impact item `saucer-and-core`: a torpedo
// destroys the saucer for points, and is absorbed by the star core. Two runs: (1) a torpedo
// launched at a posed saucer destroys it and scores 200; (2) a torpedo launched into the
// core (no targets) is absorbed and removed with no score.
//
// Only the first scenario is posed in `arrange`; both launches consume time, so both run in
// `act` — and the clip shows the pair back to back, the torpedo killing the saucer and then a
// second one vanishing into the star.
//
// The second scenario is re-posed inside `act` with SETTERS rather than a fresh game:
// `api.reset` would take the clock back mid-phase and freeze the recording, which is why the
// runtime forbids it there.
//
// The sweeps run to 2 s x 120 Hz = 240 ticks and 1.5 s = 180 ticks, each polled a single tick at
// a time (the old `1 / 120` chunk) so the state is read the instant the torpedo is spent.

import { newGame, poseShip, SAUCER_SCORE, TICK } from "../_helpers.mjs";

export default function item() {
  // The outcome of the saucer run and of the core run, read by `assert`.
  let hitSaucer;
  let core;

  return {
    id: "torpedo-impact.saucer-and-core",

    // (1) Torpedo vs saucer.
    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await api.call("setScore", 0);
      await poseShip(api, { x: 200, y: 360, vx: 0, vy: 0, angle: 0 });
      await api.call("spawnSaucer");
      await api.call("setSaucer", { x: 430, y: 360, vx: 0, vy: 0 }); // ahead, clear of the star's avoidance
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      hitSaucer = await api.until(
        (s) => s.saucer === null || s.torpedoes.length === 0,
        { max: 240, poll: TICK },
      );

      // (2) Torpedo into the core, re-posed with control ops only. The first sweep can
      // end on the saucer dying, so wait for the field to be clear of torpedoes before
      // launching the second — otherwise a survivor from run (1) would still be in flight
      // when run (2) waits for ITS torpedo to be absorbed. A fresh game would clear it,
      // but `api.reset` is forbidden here: it would take the clock back and freeze the
      // recording.
      await api.until((s) => s.torpedoes.length === 0, {
        max: 240,
        poll: TICK,
      });
      await api.call("clearRocks");
      await api.call("removeSaucer");
      await api.call("setScore", 0);
      await poseShip(api, { x: 200, y: 360, vx: 0, vy: 0, angle: 0 }); // aimed at the core
      await api.call("setTorpedoReady", true);
      await api.call("press", "KeyF");
      core = await api.until((s) => s.torpedoes.length === 0, {
        max: 180,
        poll: TICK,
      });
    },

    async assert(api, check) {
      check.expectEq(
        "a torpedo destroys the saucer",
        hitSaucer.snap.saucer,
        null,
      );
      check.expectEq(
        "destroying the saucer with a torpedo scores 200",
        hitSaucer.snap.score,
        SAUCER_SCORE,
      );

      check.expectOk(
        "the torpedo reaches and is absorbed by the core within its flight time",
        core.hit,
      );
      check.expectEq(
        "the core absorbs the torpedo (removed)",
        core.snap.torpedoes.length,
        0,
      );
      check.expectEq(
        "absorbing a torpedo at the core scores nothing",
        core.snap.score,
        0,
      );
    },
  };
}
