// alert.lanternjaw-none: the Lanternjaw fires no detection alert — its bulb is the tell.
//
// The pose is instant (`arrange`); the sampling sweep that watches for a chase and for
// any alert consumes time, so it is `act`, and the clip shows exactly that acquisition.
import {
  startPlaying,
  findSightLine,
  denAllExcept,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let sawChase = false;
  let anyAlert = false;

  return {
    id: "alert.lanternjaw-none",

    async arrange(api) {
      const snap = await startPlaying(api);
      const line = findSightLine(snap, 3);
      await denAllExcept(api, ["lanternjaw"]);
      await api.call("setForager", {
        tx: line.forager.tx,
        ty: line.forager.ty,
      });
      await api.call("setPredator", "lanternjaw", {
        tx: line.pred.tx,
        ty: line.pred.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
      await api.call("setBrightness", 1);
    },

    async act(api) {
      // 30 samples, each one moment after the last. The old loop stepped 0.02 s a pass,
      // which is 2.4 ticks — not a whole tick, and the contract refuses to round it. Two
      // ticks is the right call here: the beat is "look again a moment later", not a
      // measured duration, so the sweep still covers the acquisition it watches for.
      for (let i = 0; i < 30; i++) {
        await api.advance(2);
        const p = pred(await api.snapshot(), "lanternjaw");
        if (p.state === "chase") sawChase = true;
        if (p.alert === true) anyAlert = true;
      }
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectOk(
        "the Lanternjaw does acquire the forager (so the check is meaningful)",
        sawChase,
      );
      check.expectOk(
        "the Lanternjaw never fires a detection alert",
        anyAlert === false,
      );
    },
  };
}
