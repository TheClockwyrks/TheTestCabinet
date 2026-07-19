// Automated validation for the Combo sub-item `window-duration`.
//
// The combo window is 3.5 seconds of game time — 28 ticks. Two real eats open the
// window and raise the multiplier to x2, then single ticks are stepped without eating
// (driftTicks repositions to a clear lane and parks the pellet, leaving combo state
// untouched so the real window drain resolves). The window is read back tick by tick:
// still open through 27 total ticks, closed (and the multiplier reset) at 28 — 3.5 s.
// All exact under the manual clock.

import { eatSequence, driftTicks, hLane, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combo.window-duration");

  await beginRound(api);
  await eatSequence(api, { count: 2 }); // opens the window; the 2nd eat is tick 1 of its life
  const w0 = (await api.snapshot()).comboWindow;
  check.expectGt("the window reopened near full on the eat", w0, 3.0);

  // Step single non-eat ticks. The eat itself was tick 1 of the window's life, so 26
  // more ticks is 27 total (still open) and 27 more is 28 total (3.5 s — closed).
  const snaps = await driftTicks(api, 27);

  check.expectGt("still open after 27 ticks total", snaps[25].comboWindow, 0);
  check.expectEq("the multiplier holds while the window is open", snaps[25].combo, 2);
  check.expectEq("closed after 28 ticks total (3.5 s)", snaps[26].comboWindow, 0);
  check.expectEq("the multiplier reset when the window closed", snaps[26].combo, 1);

  await liveClip(api, { snake: hLane(3, 8, 3), pellet: { col: 4, row: 8 } });
  return check.verdict();
}
