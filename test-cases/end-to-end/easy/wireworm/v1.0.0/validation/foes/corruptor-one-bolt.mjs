// Automated validation for foes.corruptor-one-bolt: the corruptor dies to a single
// bolt and pays the largest bounty (1000).
//
// A corruptor above the cursor is the precondition; the kill is produced by the real
// resolveBolt -> hitFoe path (a corruptor dies on the first hit) and read back as its
// removal and the score gain.

import { fireAndResolve, foesOf, freshBoard } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.corruptor-one-bolt");

  await freshBoard(api);
  await api.call("spawnFoe", "corruptor", { row: 3, x: 640, vx: 0 });
  await api.call("setCursor", 640, 688);

  const before = (await api.snapshot()).score;
  const snap = await fireAndResolve(api, 2);
  check.expectEq("a single bolt kills the corruptor", foesOf(snap, "corruptor").length, 0);
  check.expectEq("the corruptor pays the largest bounty (1000)", snap.score - before, 1000);

  await freshBoard(api);
  await api.call("spawnFoe", "corruptor", { row: 3, x: 640, vx: 0 });
  await api.call("setCursor", 640, 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(800);

  return check.verdict();
}
