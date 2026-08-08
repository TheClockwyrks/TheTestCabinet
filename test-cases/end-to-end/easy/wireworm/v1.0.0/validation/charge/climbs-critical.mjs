// Automated validation for charge.climbs-critical: successive bumps raise a node
// 0->1->2->3 and cap at critical (3).
//
// Each rung is a fresh bump of a node at a chosen starting charge; the resulting
// charge is produced by the real stepWorm -> chargeNode and read back. The cap is
// checked by bumping a node already at 3: once critical the worm dives it (real
// path) and the charge stays 3.

import {
  actWormStep,
  actWormToColumn,
  chargeAt,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

// Each bump raises the node one level: 0->1, 1->2, 2->3.
const RUNGS = [0, 1, 2];

const NODE_C = 20;
const R = 5;
// Six tiles of run-up before each bump. It is what separates the rungs in the
// clip: posed a tile short, the four bumps landed 0.14 s apart and read as one
// event rather than a node climbing a level at a time (see `actWormToColumn`).
const START_C = NODE_C - 7;

/** Re-pose the rung: a node at `charge` with the worm back at its run-up start. */
async function poseRung(api, charge) {
  await api.call("clearField");
  await api.call("setNode", NODE_C, R, charge);
  await setWorm(api, straightWorm(START_C, R, 5, 1), 1, 1);
}

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
      await poseRung(api, RUNGS[0]);
    },

    async act(api) {
      for (let i = 0; i < RUNGS.length; i++) {
        // `clearField` empties the nodes and `setWorm` replaces the worms, which
        // between them cover everything this scenario touches — no foe is ever
        // spawned here, so there is nothing else the previous rung could leak.
        if (i > 0) await poseRung(api, RUNGS[i]);
        await actWormToColumn(api, NODE_C - 1); // ~0.84s of run-up into this rung
        bumped.push(chargeAt(await actWormStep(api), NODE_C, R));
      }

      // Cap: a node already at critical stays at 3 (the worm dives it instead).
      await poseRung(api, 3);
      await actWormToColumn(api, NODE_C - 1);
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
        chargeAt(capped, NODE_C, R),
        3,
      );
      check.expectOk(
        "the worm dives the critical node rather than charging it",
        head(capped).c === NODE_C - 1,
      );
    },
  };
}
