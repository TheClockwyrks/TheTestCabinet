// Automated validation (Warhead) for the Torpedo-impact item `saucer-and-core`: a torpedo
// destroys the saucer for points, and is absorbed by the star core. Two runs: (1) a torpedo
// launched at a posed saucer destroys it and scores 200; (2) a torpedo launched into the
// core (no targets) is absorbed and removed with no score.

import { newGame, poseShip, stepUntil, SAUCER_SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo-impact.saucer-and-core");

  // (1) Torpedo vs saucer.
  await newGame(api);
  await api.call("clearRocks");
  await api.call("setScore", 0);
  await poseShip(api, { x: 200, y: 360, vx: 0, vy: 0, angle: 0 });
  await api.call("spawnSaucer");
  await api.call("setSaucer", { x: 430, y: 360, vx: 0, vy: 0 }); // ahead, clear of the star's avoidance
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");
  const hitSaucer = await stepUntil(api, (s) => s.saucer === null || s.torpedoes.length === 0, 2, 1 / 120);
  check.expectEq("a torpedo destroys the saucer", hitSaucer.snap.saucer, null);
  check.expectEq("destroying the saucer with a torpedo scores 200", hitSaucer.snap.score, SAUCER_SCORE);

  // (2) Torpedo into the core.
  await newGame(api);
  await api.call("clearRocks");
  await api.call("removeSaucer");
  await api.call("setScore", 0);
  await poseShip(api, { x: 200, y: 360, vx: 0, vy: 0, angle: 0 }); // aimed at the core
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");
  const core = await stepUntil(api, (s) => s.torpedoes.length === 0, 1.5, 1 / 120);
  check.expectOk("the torpedo reaches and is absorbed by the core within its flight time", core.hit);
  check.expectEq("the core absorbs the torpedo (removed)", core.snap.torpedoes.length, 0);
  check.expectEq("absorbing a torpedo at the core scores nothing", core.snap.score, 0);

  await liveClip(api, 700);
  return check.verdict();
}
