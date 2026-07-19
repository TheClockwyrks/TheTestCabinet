// Automated validation for controls.panel-layout-stable: the inspector's action buttons hold
// fixed slots. While one structure stays selected, a change in game state that the player did
// not trigger — here, a wave ending and the build phase reopening — must not add, remove, or
// move a single button; it may only flip an action between enabled and disabled.
//
// This is the regression that makes a panel dangerous to use: if DISMANTLE appears only in the
// build phase, then the moment a wave ends every button above it slides up one slot, and a
// click aimed at the targeting control lands on an irreversible dismantle instead.

import { startBuild, placeCandidate, clearWave, snap } from "../_helpers.mjs";

// The panel is read from the last rendered frame, so let a couple of frames land first.
async function panel(api) {
  await api.wait(60);
  return api.call("panelButtons");
}

// Slot geometry + action order, ignoring the enabled/disabled state that is allowed to change.
function layoutOf(buttons) {
  return buttons.map((b) => `${b.action}@${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)}x${Math.round(b.h)}`).join(" | ");
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.panel-layout-stable");

  await startBuild(api);
  await api.call("setIntegrity", 999);
  const cand = await placeCandidate(api, "capacitor", 1, 2, 7); // near the entry: a quick clear
  await api.call("keep", cand.id); // harvests it and launches Wave 1

  // Keep the standing component selected across the wave -> build transition.
  await api.call("select", cand.id);
  const during = await panel(api);
  check.expectOk("the inspector draws its action buttons during a live wave", during.length > 0);

  const dismantleDuring = during.find((b) => b.action === "remove");
  check.expectOk("DISMANTLE is drawn during the wave", !!dismantleDuring);
  check.expectEq("...and is disabled, because dismantling is a build-phase correction", dismantleDuring?.disabled, true);

  await clearWave(api, 200); // the wave ends on its own — NOT a player action
  const s = await snap(api);
  check.expectEq("the wave ended and the build phase reopened", s.phase, "build");

  await api.call("select", cand.id);
  const after = await panel(api);

  check.expectEq("the same buttons occupy the same slots after the phase changed", layoutOf(after), layoutOf(during));

  const dismantleAfter = after.find((b) => b.action === "remove");
  check.expectEq("DISMANTLE only became enabled; it did not move", dismantleAfter?.disabled, false);
  check.expectEq("...and it kept its slot exactly", dismantleAfter?.y, dismantleDuring?.y);

  await api.screenshot("panel");
  return check.verdict();
}
