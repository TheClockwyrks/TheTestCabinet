// sonar.not-reveal-amber: a pulse marks the Gloamfin but never the Lanternjaw (an
// amber-light entity) — after the same pulse the Gloamfin is lit and the Lanternjaw
// is not.
//
// Both predators are posed inside the flood in `arrange`; the pulse and the sweep that
// marks one and not the other is the real sim, so it is `act`, and the capture at the end
// is the reviewer's evidence.
import {
  startPlaying,
  denAllExcept,
  findSonarSenseTiles,
  pred,
} from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "sonar.not-reveal-amber",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin", "lanternjaw"]);
      const [g, l] = findSonarSenseTiles(snap, snap.forager, 2);
      await api.call("setPredator", "gloamfin", {
        tx: g.tx,
        ty: g.ty,
        mode: "wander",
      });
      await api.call("setPredator", "lanternjaw", {
        tx: l.tx,
        ty: l.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton"); // keep the forager dark (g stays 0)
      await api.call("clearCooldowns");
    },

    async act(api) {
      await api.call("press", "Space");
      // 180 ticks = the old 1.5 s cap; poll 6 = the old 0.05 s sweep chunk.
      r = await api.until((s) => pred(s, "gloamfin").lit === true, {
        max: 180,
        poll: 6,
      });
      await api.settle(100); // a REAL pause (the old wait(100)) so the still is painted
      await api.screenshot("amber");
    },

    async assert(api, check) {
      const s = r.snap;
      check.expectOk(
        "the sonar marks the Gloamfin visible",
        pred(s, "gloamfin").lit === true,
      );
      check.expectOk(
        "the sonar never reveals the amber Lanternjaw",
        pred(s, "lanternjaw").lit === false,
      );
    },
  };
}
