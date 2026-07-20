// Automated validation (Warhead) for the Torpedo-impact item `harder-scatter`: a torpedo
// kill blasts the fragments outward with clearly more force than a bullet shatter. A Large is
// destroyed by a torpedo and the spread between its two fragments' velocities measured, then
// the same is done for a bullet kill; the torpedo spread must be far larger (about 2 x 240 vs
// 2 x 90 px/s). The spread cancels the shared parent/gravity velocity, isolating the kick.

import { newGame, poseShip, stepUntil, fireUntilGone, hyp, TORPEDO_SCATTER, liveClip } from "../_helpers.mjs";

function fragSpread(rocks) {
  const m = rocks.filter((r) => r.size === "medium");
  if (m.length < 2) return 0;
  return hyp(m[0].vx - m[1].vx, m[0].vy - m[1].vy);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo-impact.harder-scatter");

  // Torpedo kill.
  await newGame(api);
  await api.call("clearRocks");
  // Along the top of the field, clear of the central star, so the torpedo strikes the
  // rock rather than being taken by the core on the way.
  await poseShip(api, { x: 200, y: 150, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "large", { x: 600, y: 150, vx: 0, vy: 0 });
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");
  const torp = await stepUntil(api, (s) => s.torpedoes.length === 0, 2, 1 / 120);
  const torpSpread = fragSpread(torp.snap.rocks);

  // Bullet kill, for comparison.
  await newGame(api);
  await api.call("clearRocks");
  await api.call("addRock", "large", { x: 380, y: 220, vx: 0, vy: 0 });
  await fireUntilGone(api, "large");
  const bulletSpread = fragSpread((await api.snapshot()).rocks);

  check.expectClose("a torpedo blasts fragments apart at ~2 x 240 px/s", torpSpread, 2 * TORPEDO_SCATTER, 90);
  check.expectGt("the torpedo scatter is far stronger than a bullet shatter", torpSpread, bulletSpread * 2);

  await liveClip(api, 700);
  return check.verdict();
}
