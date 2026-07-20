// Automated validation for the Modes sub-item `hundred`.
//
// The Hundred starts with its own economy and runs a single 100-unit onslaught rather
// than a scaling wave schedule (specs/modes.md — 600 money, 20 lives, one wave). We
// start it, read the economy, and release the onslaught.

import { newGame, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.hundred");

  const s = await newGame(api, "hundred");
  check.expectEq("The Hundred starts with 600 money", s.money, 600);
  check.expectEq("The Hundred starts with 20 lives", s.lives, 20);
  check.expectEq("The Hundred is a single wave", s.waveCount, 1);
  check.expectEq("its mode reads as The Hundred", s.mode, "hundred");

  await api.call("setLives", 1000000);
  await api.call("startWave");
  const r = await stepUntil(api, (t) => t.phase === "wave" && t.surge.length > 0, 6);
  check.expectOk("the onslaught releases surge", r.hit);

  await liveClip(api, 2000);
  return check.verdict();
}
