// scoring.depth-scaling: a deeper trench speeds the predators up and shortens the sonar
// range.
//
// The lone wanderer is posed instantly (`arrange`); both depth settings and the moment
// each needs to take effect in the sim are `act`, so the clip shows the same predator
// moving at two depths.
import { startPlaying, denAllExcept, findFarTile, pred } from "../_helpers.mjs";

export default function item() {
  let s1;
  let s5;
  let speed1;
  let speed5;

  return {
    id: "scoring.depth-scaling",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["gloamfin"]);
      const far = findFarTile(snap, snap.forager, 8);
      await api.call("setPredator", "gloamfin", {
        tx: far.tx,
        ty: far.ty,
        mode: "wander",
      });
      await api.call("poseLastPlankton");
    },

    async act(api) {
      await api.call("setDepth", 1);
      await api.advance(24); // 24 ticks = the old 0.2 s
      s1 = await api.snapshot();
      speed1 = pred(s1, "gloamfin").speed;

      await api.call("setDepth", 5);
      await api.advance(24); // 24 ticks = the old 0.2 s
      s5 = await api.snapshot();
      speed5 = pred(s5, "gloamfin").speed;

      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectGt("predators are faster at greater depth", speed5, speed1);
      check.expectClose(
        "sonar range is 9 tiles at depth 1",
        s1.sonar.range,
        9,
        1,
      );
      check.expectLt(
        "sonar range shrinks at greater depth",
        s5.sonar.range,
        s1.sonar.range,
      );
      check.expectGe("sonar range never drops below 5", s5.sonar.range, 5);
    },
  };
}
