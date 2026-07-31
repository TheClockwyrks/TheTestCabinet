// Automated validation for the Refund sub-item `partial`.
//
// Selling a tower that has fought a wave refunds 70% of everything spent on it
// (specs/towers.md). We place an Arc (cost 15) off in the corner, run wave 1 to a
// clear so the tower has fought, then sell it and read what the sale paid back —
// 70% of 15 is 10.
//
// The sale is driven through the debug `sellTower` op, which is the selling CODE
// without any particular way of reaching it. The two user-facing paths are covered
// elsewhere and differently: the hotkey by `controls.sell-key`, and the inspector's
// Sell button by a reviewer's eye. The button cannot be driven here — `specs/ui.md`
// asks for a Sell action in the inspector without fixing where it sits, and the debug
// API exposes no way to read a button's rect back, so there is no coordinate an
// automated check could click that would be correct for every conformant layout. A
// build whose hotkey works while its Sell button does nothing therefore passes this
// item and `controls.sell-key`, and is caught in review rather than here.

import { newGame, build, actTail } from "../_helpers.mjs";

export default function item() {
  let id;
  let cleared;
  let before;
  let after;

  return {
    id: "refund.partial",

    // The wave is skipped entirely in `arrange`; what is filmed is the sale and the
    // balance moving. The ceiling covers the beat either side of it.
    clipMs: 6500,

    // The Arc goes far from any lane so it never fires — the refund is about having
    // lived through a wave, not about what the tower did during it.
    //
    // Which is also why the wave itself is skipped outright rather than partly. For
    // the surge items the arrival at an exhaust IS the claim, so their clips pick the
    // approach back up; here the wave is nothing but a precondition — the thing under
    // test is the percentage that comes back when a FOUGHT tower is sold. So `arrange`
    // runs wave 1 through to its clear unfilmed and `act` is the sale alone. 2400
    // ticks = the old 40s cap, kept as the skip's ceiling since the skip decides
    // nothing; the wave number only changes at the clear, so a coarse poll is enough.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
      id = await build(api, "arc", 40, 30); // far from any lane, so it never fires
      await api.call("startWave");
      cleared = await api.skipUntil((s) => s.wave >= 2, {
        max: 2400,
        poll: 12,
      });
    },

    // Sell, and measure the refund as the CHANGE in the balance across the sale.
    //
    // Reading the balance afterwards as if it were the refund quietly assumes the
    // balance was exactly 0 when the sale happened, and that assumption does not
    // survive contact with a real build. A run against a build sitting at -1 sold the
    // Arc, went to 9, and was reported as a 9-refund failing a required 10 — when the
    // refund it actually paid was 10, exactly right. The balance a build arrives at is
    // its own business (a leaked wave, a mode's economy, an overspend it allows); what
    // this item claims is what SELLING pays back. A difference measures that and is
    // immune to wherever the balance happened to start.
    //
    // `setMoney(0)` stays, because it keeps the numbers legible on screen and keeps
    // the clip's HUD readable, but nothing now depends on it having taken effect.
    //
    // The `before` read sits AFTER the held beat and immediately before the sale, not
    // before the beat — the difference has to bracket the sale and NOTHING else. Read
    // it earlier and the beat is inside the measurement: a build whose balance drifts
    // by a coin over that second and a half (this one drifts to -1) has the drift
    // subtracted from its refund, and a correct 10 is reported as 9. Which is exactly
    // the false failure this whole read was rewritten to remove, reintroduced one line
    // too high up.
    async act(api) {
      await api.call("setMoney", 0);
      await actTail(api); // hold on the balance beside the fought Arc

      before = (await api.snapshot()).money;
      await api.call("sellTower", id);
      after = (await api.snapshot()).money;
      await actTail(api, 120); // 2 s on the cleared tile and the refund paid
    },

    async assert(api, check) {
      check.expectOk("wave 1 was fought and cleared", cleared.hit);
      check.expectEq(
        "selling a fought tower pays back 70% of its 15 cost (10)",
        after - before,
        10,
      );
    },
  };
}
