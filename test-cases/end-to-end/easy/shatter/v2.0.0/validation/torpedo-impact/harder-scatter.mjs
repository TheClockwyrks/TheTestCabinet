// Automated validation (Warhead) for the Torpedo-impact item `harder-scatter`: a torpedo
// kill blasts the fragments outward with clearly more force than a bullet shatter. A Large is
// destroyed by a torpedo and the spread between its two fragments' velocities measured, then
// the same is done for a bullet kill; the torpedo spread must be far larger (about 2 x 240 vs
// 2 x 90 px/s). The spread cancels the shared parent/gravity velocity, isolating the kick.
//
// Only the torpedo scenario is posed in `arrange`; both kills consume time, so both run in
// `act` — and the clip is the comparison itself, a reviewer watching the torpedo blast the
// fragments apart and then the gun barely nudge them.
//
// The bullet scenario is re-posed inside `act` with SETTERS (`clearRocks` then `addRock`, with
// no time between them so the wave spawner never sees an empty field) rather than a fresh game:
// `api.reset` would take the clock back mid-phase and freeze the recording, which is why the
// runtime forbids it there.
//
// The torpedo sweep runs to 2 s x 120 Hz = 240 ticks, polled a single tick at a time (the old
// `1 / 120` chunk) so the fragments are read the instant they are created, before they drift.

import {
  newGame,
  poseShip,
  actFireUntilGone,
  hyp,
  TORPEDO_SCATTER,
  TICK,
} from "../_helpers.mjs";

function fragSpread(rocks) {
  const m = rocks.filter((r) => r.size === "medium");
  if (m.length < 2) return 0;
  return hyp(m[0].vx - m[1].vx, m[0].vy - m[1].vy);
}

export default function item() {
  // The fragment spread each weapon produced, compared by `assert`.
  let torpSpread;
  let bulletSpread;

  return {
    id: "torpedo-impact.harder-scatter",

    // Torpedo kill. Along the top of the field, clear of the central star, so the torpedo
    // strikes the rock rather than being taken by the core on the way.
    async arrange(api) {
      await newGame(api);
      await api.call("clearRocks");
      await poseShip(api, { x: 200, y: 150, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "large", { x: 600, y: 150, vx: 0, vy: 0 });
      await api.call("setTorpedoReady", true);
    },

    async act(api) {
      await api.call("press", "KeyF");
      const torp = await api.until((s) => s.torpedoes.length === 0, {
        max: 240,
        poll: TICK,
      });
      torpSpread = fragSpread(torp.snap.rocks);

      // Bullet kill, for comparison. Re-posed with control ops only.
      await api.call("clearRocks");
      await api.call("addRock", "large", { x: 380, y: 220, vx: 0, vy: 0 });
      await actFireUntilGone(api, "large");
      bulletSpread = fragSpread((await api.snapshot()).rocks);
    },

    async assert(api, check) {
      check.expectClose(
        "a torpedo blasts fragments apart at ~2 x 240 px/s",
        torpSpread,
        2 * TORPEDO_SCATTER,
        90,
      );
      check.expectGt(
        "the torpedo scatter is far stronger than a bullet shatter",
        torpSpread,
        bulletSpread * 2,
      );
    },
  };
}
