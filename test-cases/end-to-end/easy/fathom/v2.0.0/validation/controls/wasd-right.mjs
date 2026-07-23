// controls.wasd-right: holding D drives the forager right a corridor, like ArrowRight.
//
// The helper is split across the runtime's seam: `arrangeMoveKey` poses the forager on
// a tile with somewhere to go (instant), and `actMoveKey` holds the key and runs the
// real sim — so the clip is the forager actually swimming under the held D key.
import { arrangeMoveKey, actMoveKey, movedAlong } from "../_helpers.mjs";

export default function item() {
  let out;

  return {
    id: "controls.wasd-right",

    async arrange(api) {
      await arrangeMoveKey(api, "right");
    },

    async act(api) {
      out = await actMoveKey(api, "KeyD");
    },

    async assert(api, check) {
      check.expectEq(
        "holding D gives the forager a rightward heading",
        out.after.dir,
        "right",
      );
      check.expectOk(
        "holding D moves the forager right a tile",
        movedAlong(out.before, out.after, "right"),
      );
    },
  };
}
