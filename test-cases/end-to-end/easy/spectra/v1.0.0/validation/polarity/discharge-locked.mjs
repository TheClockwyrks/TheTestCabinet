// Automated validation for the Polarity sub-item `discharge-locked`.
//
// Below full resonance a discharge does nothing: the meter is not spent and no
// discharge wave fires. The meter is posed one point short of full and a discharge
// triggered; nothing changes.

import { startClean } from "../_helpers.mjs";

export default function item() {
  // The state read the instant the (refused) discharge was triggered.
  let snap;

  return {
    id: "polarity.discharge-locked",

    // A live stage-1 wave with the meter one point short of full. The wave is kept
    // (`clear: false`) so the clip has a populated field: the behavior under test is
    // that NOTHING is swept away, which only reads on screen if there is something
    // there to have been swept. Nothing on the field is asserted on.
    async arrange(api) {
      await startClean(api, { clear: false });
      await api.call("setResonance", 99); // one short of full
    },

    async act(api) {
      await api.call("discharge");
      // Read immediately: a discharge that fired would have spent the meter and
      // raised its flag in the same instant, so no time need pass to catch it.
      snap = await api.snapshot();

      // Let the wave play on, showing the swarm untouched and the meter still held
      // at 99 — the refusal, rather than a generic clip of the game running.
      await api.advance(156); // 156 ticks = the old liveWaveClip's 1300 ms
    },

    async assert(api, check) {
      check.expectEq(
        "a below-full discharge does not spend the meter",
        snap.resonance,
        99,
      );
      check.expectOk(
        "no discharge wave fires below full",
        snap.discharge.active === false,
      );
    },
  };
}
