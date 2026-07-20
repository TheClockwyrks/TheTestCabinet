// Automated validation for charge.shot-critical-detonates: a bolt into a critical
// node detonates it — removing it entirely and scoring the discharge purge — rather
// than knocking it down a level.
//
// An isolated critical node above the cursor is the precondition; the detonation is
// produced by the real resolveBolt -> hitNode -> detonate path and read back. The
// node is gone (a de-energize would have left it at charge 2), and the score gains
// the discharge purge bonus (larger than an inert node's clear).

import { chargeAt, fireAndResolve, freshBoard, tileCX } from "../_helpers.mjs";

const C = 20;
const R = 10;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.shot-critical-detonates");

  await freshBoard(api);
  await api.call("setNode", C, R, 3); // an isolated critical node
  await api.call("setCursor", tileCX(C), 688);

  const before = (await api.snapshot()).score;
  const snap = await fireAndResolve(api);

  check.expectEq("the critical node is removed entirely (not de-energized)", chargeAt(snap, C, R), -1);
  check.expectGt("detonating scores the discharge purge (more than an inert clear)", snap.score - before, 1);

  // A live clip of a critical node detonating.
  await freshBoard(api);
  await api.call("setNode", C, R, 3);
  await api.call("setCursor", tileCX(C), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(700);

  return check.verdict();
}
