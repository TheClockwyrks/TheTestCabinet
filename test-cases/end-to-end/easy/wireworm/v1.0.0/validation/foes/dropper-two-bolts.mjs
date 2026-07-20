// Automated validation for foes.dropper-two-bolts: the dropper survives its first
// bolt (which only speeds it up) and dies to the second, paying its bounty (200).
//
// A dropper just above the cursor is the precondition; both outcomes are produced by
// the real hitFoe dropper branch (first hit sets hitOnce and speeds it, second
// removes it) and read back. The dropper is posed close to the cursor (rather than
// high up the column) because a falling dropper reseeds inert nodes down its own
// column, and firing up that column from far below would clear that trail instead —
// so we hit the dropper itself before it lays a shielding node in the firing lane.

import { fireAndResolve, foesOf, freshBoard, stepUntil, tileCY } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.dropper-two-bolts");

  await freshBoard(api);
  await api.call("spawnFoe", "dropper", { x: 640, y: tileCY(17) });
  await api.call("setCursor", 640, 688);

  const before = (await api.snapshot()).score;

  // First bolt: the dropper survives, marked as having taken its speed-up hit.
  await api.call("fire");
  const first = (await stepUntil(api, (s) => foesOf(s, "dropper")[0]?.firstHit || foesOf(s, "dropper").length === 0, 1.5)).snap;
  const d = foesOf(first, "dropper")[0];
  check.expectOk("the dropper survives its first bolt", !!d);
  check.expectOk("the first hit only speeds it up (marks it hit once)", d?.firstHit === true);

  // Second bolt: the dropper dies.
  const second = await fireAndResolve(api, 2);
  check.expectEq("the second bolt kills the dropper", foesOf(second, "dropper").length, 0);
  check.expectEq("killing the dropper pays its bounty (200)", second.score - before, 200);

  // A live clip of the two-hit kill.
  await freshBoard(api);
  await api.call("spawnFoe", "dropper", { x: 640, y: tileCY(17) });
  await api.call("setCursor", 640, 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(400);
  await api.call("fire");
  await api.wait(700);

  return check.verdict();
}
