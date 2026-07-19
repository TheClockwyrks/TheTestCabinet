// Automated validation for foes.glitch-one-bolt: the glitch dies to a single bolt
// and pays its bounty (300).
//
// A glitch above the cursor is the precondition; the kill is produced by the real
// resolveBolt -> hitFoe path (a glitch dies on the first hit) and read back as the
// foe's removal and the score gain.

import { fireAndResolve, foesOf, freshBoard, liveClip, tileCY } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.glitch-one-bolt");

  await freshBoard(api);
  await api.call("spawnFoe", "glitch", { x: 640, y: tileCY(13), vx: 0 });
  await api.call("setCursor", 640, 688);

  const before = (await api.snapshot()).score;
  const snap = await fireAndResolve(api);
  check.expectEq("a single bolt kills the glitch", foesOf(snap, "glitch").length, 0);
  check.expectEq("the glitch pays its bounty (300)", snap.score - before, 300);

  await freshBoard(api);
  await api.call("spawnFoe", "glitch", { x: 640, y: tileCY(13), vx: 0 });
  await api.call("setCursor", 640, 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(700);

  return check.verdict();
}
