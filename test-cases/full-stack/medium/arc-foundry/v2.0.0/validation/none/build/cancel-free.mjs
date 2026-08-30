// Automated validation for build.cancel-free: cancelling a held (un-dropped) rock costs no
// stamp and no Charge.
//
// The press is pulled with the B key (arming a held rock), then cancelled with Esc; the stamp
// allowance and Charge are unchanged and no rock remains held.
//
// Opening the run and pulling the press are control ops, so the arrange leaves a rock held on
// the cursor. The CANCEL is the behavior under test, so it — and the reads either side of it —
// is the act, and the clip shows the held rock being put back.

// WHY THIS IS A CLIP RATHER THAN A STILL. Cancelling leaves nothing behind — no rock on the
// cursor, no rock on the board, and the same allowance and Charge as before — so a frame of the
// aftermath is a frame of an untouched build phase, which shows neither the rock that was held
// nor the fact that putting it back cost nothing. Both halves have to be on screen: the armed
// rock on the cursor, and the same HUD once it is gone.

import { startBuild, snap, SECOND } from "../_helpers.mjs";

// A beat with the rock held on the cursor before it is put back, and a beat on the board it left
// unchanged. The allowance and Charge are readable in the HUD across both.
const HELD_TICKS = 1.5 * SECOND;
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The opening allowance, and the board either side of the cancel, all read by `assert`.
  let s0;
  let s1;
  let s2;

  return {
    id: "build.cancel-free",

    async arrange(api) {
      s0 = await startBuild(api);
      await api.call("press", "KeyB"); // pull the press → a blank rock is held
    },

    async act(api) {
      s1 = await snap(api);
      await api.advance(HELD_TICKS); // the rock on the cursor, with the allowance still at five

      await api.call("press", "Escape"); // cancel the held rock
      s2 = await snap(api);

      await api.advance(TAIL_TICKS); // the hand empty, and nothing spent for it
    },

    async assert(api, check) {
      check.expectOk("a rock is held after pulling the press", !!s1.held && s1.held.active);
      check.expectOk("no rock is held after cancelling", !s2.held || !s2.held.active);
      check.expectEq("cancelling spends no stamp", s2.stampsLeft, s0.stampsLeft);
      check.expectEq("cancelling costs no Charge", s2.charge, s0.charge);
    },
  };
}
