// Automated validation for controls.panel-layout-stable: the inspector's action buttons hold
// fixed slots. While one structure stays selected, a change in game state that the player did
// not trigger — here, a wave ending and the build phase reopening — must not add, remove, or
// move a single button; it may only flip an action between enabled and disabled.
//
// This is the regression that makes a panel dangerous to use: if DISMANTLE appears only in the
// build phase, then the moment a wave ends every button above it slides up one slot, and a
// click aimed at the targeting control lands on an irreversible dismantle instead.
//
// Standing the component up and launching Wave 1 is all control ops (the arrange). Everything
// that follows depends on the wave ENDING, which consumes time, so both panel reads and the
// clear between them are the act — and that is the right clip: it shows the panel holding still
// across exactly the transition the player did not ask for.

import { startBuild, placeCandidate, actClearWave, snap, SECOND } from "../_helpers.mjs";

// The panel is read from the last RENDERED frame, so let a couple of frames land first. This is
// a real 60 ms pause in both passes — instant stepping never paints — which is precisely what
// `settle` exists for.
async function panel(api) {
  await api.settle(60);
  return api.call("panelButtons");
}

// Slot geometry + action order, ignoring the enabled/disabled state that is allowed to change.
function layoutOf(buttons) {
  return buttons.map((b) => `${b.action}@${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)}x${Math.round(b.h)}`).join(" | ");
}

export default function item() {
  // The selected component, the two panel reads, and the board after the wave ended.
  let candId;
  let during;
  let after;
  let s;

  return {
    id: "controls.panel-layout-stable",

    // The still this item declares is the panel after the wave ends, and that wave
    // takes ~64 s to clear — far past the 8 s default record budget, so the record pass
    // would unwind before `screenshot` ever ran and the declared output would never
    // land. The item declares no video, so this lengthens only the record pass, not any
    // media it produces.
    clipMs: 100000,

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);
      const cand = await placeCandidate(api, "capacitor", 1, 2, 7); // near the entry: a quick clear
      candId = cand.id;
      await api.call("keep", cand.id); // harvests it and launches Wave 1

      // Keep the standing component selected across the wave -> build transition.
      await api.call("select", cand.id);
    },

    async act(api) {
      during = await panel(api);

      await actClearWave(api, { maxTicks: 200 * SECOND }); // the wave ends on its own — NOT a player action
      s = await snap(api);

      await api.call("select", candId);
      after = await panel(api);

      await api.screenshot("panel");
    },

    async assert(api, check) {
      check.expectOk("the inspector draws its action buttons during a live wave", during.length > 0);

      const dismantleDuring = during.find((b) => b.action === "remove");
      check.expectOk("DISMANTLE is drawn during the wave", !!dismantleDuring);
      check.expectEq("...and is disabled, because dismantling is a build-phase correction", dismantleDuring?.disabled, true);

      check.expectEq("the wave ended and the build phase reopened", s.phase, "build");

      check.expectEq("the same buttons occupy the same slots after the phase changed", layoutOf(after), layoutOf(during));

      const dismantleAfter = after.find((b) => b.action === "remove");
      check.expectEq("DISMANTLE only became enabled; it did not move", dismantleAfter?.disabled, false);
      check.expectEq("...and it kept its slot exactly", dismantleAfter?.y, dismantleDuring?.y);
    },
  };
}
