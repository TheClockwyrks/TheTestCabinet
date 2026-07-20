// Automated validation for charge.shot-charged-deenergized: a bolt into a charged
// node knocks it down one level without removing it.
//
// A charge-2 node above the cursor is the precondition; each shot's effect is
// produced by the real resolveBolt -> hitNode and read back. Three successive shots
// take it 2 -> 1 -> 0 -> gone, proving a charged node resists clearing.

import {
  actFireAndResolve,
  chargeAt,
  freshBoard,
  tileCX,
} from "../_helpers.mjs";

const C = 20;
const R = 10;

export default function item() {
  let s1;
  let s2;
  let s3;

  return {
    id: "charge.shot-charged-deenergized",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", C, R, 2);
      await api.call("setCursor", tileCX(C), 688);
    },

    // Three successive shots up the same column, each run to resolution. The whole
    // sequence is the clip: the reviewer watches the node step down a rung per hit
    // and only go on the third, which is exactly what the assertions score.
    async act(api) {
      s1 = await actFireAndResolve(api);
      s2 = await actFireAndResolve(api);
      s3 = await actFireAndResolve(api);
    },

    async assert(api, check) {
      check.expectEq(
        "the first shot knocks charge 2 down to 1 (still present)",
        chargeAt(s1, C, R),
        1,
      );
      check.expectEq(
        "the second shot knocks it down to 0 (still present)",
        chargeAt(s2, C, R),
        0,
      );
      check.expectEq(
        "the third shot (now inert) clears it",
        chargeAt(s3, C, R),
        -1,
      );
    },
  };
}
