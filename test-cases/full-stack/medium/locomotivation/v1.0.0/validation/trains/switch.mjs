// Trains: throwing a junction lever diverts the next train on its track onto the siding
// line. Level 5's lever L1 controls T1 (default line 4, siding line 3). The worker throws
// the lever for real (E), then the sim runs until T1's first scheduled train enters — on 3.

import { actPressStep, setTile, startFresh, trainsOn } from "../_helpers.mjs";

export default function item() {
  // The lever after it was thrown, and the T1 trains once one had entered.
  let lever;
  let t1;

  return {
    id: "trains.switch",

    // Pose the worker beside level 5's L1 lever.
    async arrange(api) {
      await startFresh(api, 5);
      await setTile(api, 6, 5); // beside the lever at (6,4)
    },

    // Throw the lever for real, then wait for the scheduled train to arrive on the
    // siding. Both beats are filmed, so the clip shows the throw and the diversion it
    // causes rather than just the end state.
    async act(api) {
      const thrown = await actPressStep(api, "KeyE"); // throw the lever for real
      lever = thrown.levers.find((l) => l.id === "L1");

      await api.advance(138); // 138 ticks = the old 2.3s, past T1's first entry (phase 2.0)
      t1 = trainsOn(await api.snapshot(), "T1");

      // Keep filming so the diverted train is seen running the siding. 54 ticks = the old
      // 900ms clip hold.
      await api.advance(54);
    },

    async assert(api, check) {
      check.expectOk("the lever is thrown", lever && lever.thrown === true);
      check.expectGt("a T1 train has entered", t1.length, 0);
      if (t1.length)
        check.expectEq(
          "it was diverted onto the siding line (3)",
          t1[0].line,
          3,
        );
    },
  };
}
