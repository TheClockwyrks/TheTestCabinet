// controls.move-up: holding Up drives the forager up a corridor.
//
// The helper is split across the runtime's seam: `arrangeMoveKey` poses the forager on
// a tile with somewhere to go (instant), and `actMoveKey` holds the key and runs the
// real sim — so the clip is the forager actually swimming under a held key.
import { arrangeMoveKey, actMoveKey, movedAlong } from "../_helpers.mjs";

export default function item() {
  let out;

  return {
    id: "controls.move-up",

    async arrange(api) {
      await arrangeMoveKey(api, "up");
    },

    async act(api) {
      out = await actMoveKey(api, "ArrowUp");
    },

    async assert(api, check) {
      check.expectEq(
        "holding ArrowUp gives the forager an upward heading",
        out.after.dir,
        "up",
      );
      check.expectOk(
        "holding ArrowUp moves the forager up a tile",
        movedAlong(out.before, out.after, "up"),
      );
    },
  };
}
