// Automated validation for the Stages sub-item `extra-life`.
//
// Crossing 20000 points awards one extra life, once; a later crossing awards no
// further life. The score is posed just below 20000 and a REAL matching kill crosses
// it (the award happens in the real scoring path, not fabricated); a later kill,
// already past the threshold, adds no life. A spare drone is kept alive so clearing
// a target does not end the wave.

import { startClean, spawnDrone, shootDrone, findDrone, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stages.extra-life");

  await startClean(api);
  await api.call("setLives", 3);
  await api.call("setScore", 19950); // a formation Shard kill (+50) crosses 20000
  // A keepalive drone so destroying a target never empties the field (which would
  // end the wave); it sits far from the target lane and is never shot.
  await spawnDrone(api, { kind: "shard", band: "cyan", x: 250, y: 200, phase: "formation" });

  const first = await spawnDrone(api, { kind: "shard", band: "cyan", x: 640, y: 300, phase: "formation" });
  await shootDrone(api, first, "cyan");
  const a = await stepUntil(api, (s) => findDrone(s, first) === null, 0.5);
  check.expectGe("the score crossed 20000", a.snap.score, 20000);
  check.expectEq("crossing 20000 awards one extra life", a.snap.lives, 4);

  // A later crossing (already past 20000) awards no further life.
  const second = await spawnDrone(api, { kind: "shard", band: "cyan", x: 640, y: 300, phase: "formation" });
  await shootDrone(api, second, "cyan");
  const b = await stepUntil(api, (s) => findDrone(s, second) === null, 0.5);
  check.expectEq("a later crossing awards no further life", b.snap.lives, 4);

  await api.wait(120);
  await api.screenshot("extra-life");
  return check.verdict();
}
