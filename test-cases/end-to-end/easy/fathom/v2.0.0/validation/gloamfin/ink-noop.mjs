// gloamfin.ink-noop: ink has no effect on the sound-based Gloamfin; it keeps chasing.
//
// The chase is posed instantly (`arrange`); the ink drop and the stretch afterwards that
// proves nothing changed are the real sim, so they are `act` and are what the clip shows.
import {
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let beforeInk;
  let afterInk;

  return {
    id: "gloamfin.ink-noop",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3);
      await denAllExcept(api, ["gloamfin"]);
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      await api.call("setPredator", "gloamfin", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "chase",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      beforeInk = pred(await api.snapshot(), "gloamfin").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft"); // ink at the forager, over the line to the Gloamfin
      await api.advance(36); // 36 ticks = the old 0.3 s
      afterInk = pred(await api.snapshot(), "gloamfin").state;
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("the Gloamfin is chasing", beforeInk, "chase");
      check.expectEq(
        "ink does not stop the Gloamfin (still chasing)",
        afterInk,
        "chase",
      );
    },
  };
}
