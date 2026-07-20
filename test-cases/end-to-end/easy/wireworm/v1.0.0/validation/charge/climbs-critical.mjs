// Automated validation for charge.climbs-critical: successive bumps raise a node
// 0->1->2->3 and cap at critical (3).
//
// Each rung is a fresh bump of a node at a chosen starting charge; the resulting
// charge is produced by the real stepWorm -> chargeNode and read back. The cap is
// checked by bumping a node already at 3: once critical the worm dives it (real
// path) and the charge stays 3.

import {
  actWormStep,
  chargeAt,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

// Each bump raises the node one level: 0->1, 1->2, 2->3.
const RUNGS = [0, 1, 2];

export default function item() {
  const bumped = []; // the charge read back after each rung's bump
  let capped;

  return {
    id: "charge.climbs-critical",

    // Only the FIRST rung's scene is posed here. The other rungs are independent
    // scenarios that the old script separated with a second `freshBoard`; that
    // calls `api.reset`, which the runtime forbids inside `act` (it would hand the
    // build back its manual clock and silently freeze the recording), so they are
    // re-posed below with control ops instead.
    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 20, 5, RUNGS[0]);
      await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1);
    },

    async act(api) {
      for (let i = 0; i < RUNGS.length; i++) {
        // `clearField` empties the nodes and `setWorm` replaces the worms, which
        // between them cover everything this scenario touches — no foe is ever
        // spawned here, so there is nothing else the previous rung could leak.
        if (i > 0) {
          await api.call("clearField");
          await api.call("setNode", 20, 5, RUNGS[i]);
          await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1);
        }
        bumped.push(chargeAt(await actWormStep(api), 20, 5));
      }

      // Cap: a node already at critical stays at 3 (the worm dives it instead).
      await api.call("clearField");
      await api.call("setNode", 20, 5, 3);
      await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1);
      capped = await actWormStep(api);

      // Every operand is captured; the sim runs on only so the clip ends on the
      // worm plunging down the critical column rather than on one tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      RUNGS.forEach((start, i) => {
        check.expectEq(
          `a bump raises charge ${start} to ${start + 1}`,
          bumped[i],
          start + 1,
        );
      });
      check.expectEq(
        "charge caps at 3 (stays critical)",
        chargeAt(capped, 20, 5),
        3,
      );
      check.expectOk(
        "the worm dives the critical node rather than charging it",
        head(capped).c === 19,
      );
    },
  };
}
