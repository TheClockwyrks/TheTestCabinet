// Automated validation (Warhead) for the Torpedo item `one-charge`: secondary fire (F)
// launches a single torpedo, consuming the charge, with at most one stored and one in
// flight. With a charge ready, F is pressed twice: the first launches one torpedo and
// empties the charge; the second, with no charge and one already in flight, does nothing.

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo.one-charge");

  await newGame(api);
  await poseShip(api, { x: 300, y: 360, vx: 0, vy: 0, angle: 0 });
  await api.call("setTorpedoReady", true);
  check.expectEq("a torpedo charge is ready", (await api.snapshot()).torpedoReady, true);

  await api.call("press", "KeyF"); // launch
  const after1 = await api.snapshot();
  check.expectEq("F launches one torpedo", after1.torpedoes.length, 1);
  check.expectEq("launching consumes the charge", after1.torpedoReady, false);

  await api.call("press", "KeyF"); // no charge, one already in flight — nothing
  check.expectEq("a second F does not launch a second torpedo", (await api.snapshot()).torpedoes.length, 1);

  await liveClip(api, 800);
  return check.verdict();
}
