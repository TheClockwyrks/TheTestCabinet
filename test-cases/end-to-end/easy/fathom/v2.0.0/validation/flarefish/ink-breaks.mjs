// flarefish.ink-breaks: ink breaks the Flarefish's fix, exactly as it breaks the
// Lanternjaw's.
//
// The close sight line is posed instantly (`arrange`); the fix, the ink and the broken
// fix are the real sim running, so they are `act` and are what the clip shows.
import {
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let fixed;
  let afterInk;

  return {
    id: "flarefish.ink-breaks",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 2); // close, so the ink at the forager covers the line
      await denAllExcept(api, ["flarefish"]);
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      await api.call("setPredator", "flarefish", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
      await api.call("setBrightness", 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      fixed = pred(await api.snapshot(), "flarefish").state;
      await api.call("clearCooldowns");
      await api.call("press", "ShiftLeft");
      await api.advance(24); // 24 ticks = the old 0.2 s
      afterInk = pred(await api.snapshot(), "flarefish").state;
      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq(
        "the Flarefish is fixed on the forager first",
        fixed,
        "chase",
      );
      check.expectEq("ink breaks the Flarefish's fix", afterInk, "wander");
    },
  };
}
