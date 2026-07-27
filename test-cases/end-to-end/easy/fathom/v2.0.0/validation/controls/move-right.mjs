// controls.move-right: holding Right drives the forager right a corridor.
//
// The helper is split across the runtime's seam: `arrangeMoveKey` poses the forager on
// a tile with somewhere to go (instant), and `actMoveKey` holds the key and runs the
// real sim — so the clip is the forager actually swimming under a held key.
import { arrangeMoveKey, actMoveKey, movedAlong } from "../_helpers.mjs";

export default function item() {
  let out;

  return {
    id: "controls.move-right",

    async arrange(api) {
      await arrangeMoveKey(api, "right");
    },

    async act(api) {
      out = await actMoveKey(api, "ArrowRight");
    },

    async assert(api, check) {
      check.expectEq(
        "holding ArrowRight gives the forager a rightward heading",
        out.after.dir,
        "right",
      );
      check.expectOk(
        "holding ArrowRight moves the forager right a tile",
        movedAlong(out.before, out.after, "right", out.grid),
      );
    },
  };
}
