// Automated validation (Warhead) for the Torpedo-impact item `one-hit-any-rock`: a torpedo
// destroys any rock in one hit regardless of its armor, splitting and scoring like a bullet
// kill. A full-health Large (which the primary gun would need three hits for) is placed ahead
// and a single torpedo launched at it; the real impact code must destroy it outright.

import { newGame, poseShip, stepUntil, ROCK_SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo-impact.one-hit-any-rock");

  await newGame(api);
  await api.call("clearRocks");
  await api.call("setScore", 0);
  // Pose the ship and target along the top of the field, clear of the central star
  // (a body posed on the star or a shot fired through it would be taken by the core).
  await poseShip(api, { x: 200, y: 150, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "large", { x: 600, y: 150, vx: 0, vy: 0 }); // full-health Large, dead ahead
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");

  const { snap } = await stepUntil(api, (s) => s.torpedoes.length === 0, 2, 1 / 120);

  check.expectEq("the single torpedo is spent on the hit", snap.torpedoes.length, 0);
  check.expectEq("one torpedo destroys the full-health Large (armor ignored)", snap.rocks.filter((r) => r.size === "large").length, 0);
  check.expectEq("the destroyed Large splits into two Medium rocks", snap.rocks.filter((r) => r.size === "medium").length, 2);
  check.expectEq("the torpedo kill scores the Large's 20 points", snap.score, ROCK_SCORE.large);

  await liveClip(api, 700);
  return check.verdict();
}
