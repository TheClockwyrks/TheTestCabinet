// scoring.depth-scaling: a deeper maze holds MORE predators (one more per depth,
// capped at two of each — six total — by DEPTH 4) and a shorter sonar range, while
// predator SPEEDS do not change with depth.
//
// Both depth settings, and the moment each takes effect in the sim, are `act`, so the
// clip shows the roster and sonar recomputing across two depths. To evidence that
// speed does not scale, the same predator is posed to wander at each depth and its
// steady patrol speed is read back — it should be the same at both.
import { startPlaying, findFarTile, pred } from "../_helpers.mjs";

export default function item() {
  let s1;
  let s4;
  let count1;
  let count4;
  let speed1;
  let speed4;

  return {
    id: "scoring.depth-scaling",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      // Depth 1: the roster is one of each — three predators.
      await api.call("setDepth", 1);
      s1 = await api.snapshot();
      count1 = s1.predators.length;
      const far1 = findFarTile(s1, s1.forager, 8);
      await api.call("setPredator", "gloamfin", {
        tx: far1.tx,
        ty: far1.ty,
        mode: "wander",
      });
      await api.advance(30); // 30 ticks = 0.25 s: let it settle to its patrol speed
      speed1 = pred(await api.snapshot(), "gloamfin").speed;

      // Depth 4: the roster caps at two of each — six predators.
      await api.call("setDepth", 4);
      s4 = await api.snapshot();
      count4 = s4.predators.length;
      const far4 = findFarTile(s4, s4.forager, 8);
      await api.call("setPredator", "gloamfin", {
        tx: far4.tx,
        ty: far4.ty,
        mode: "wander",
      });
      await api.advance(30);
      speed4 = pred(await api.snapshot(), "gloamfin").speed;

      await api.advance(96); // 96 ticks = the old 800 ms live tail
    },

    async assert(api, check) {
      check.expectEq("depth 1 holds three predators (one of each)", count1, 3);
      check.expectEq("depth 4 holds six predators (two of each)", count4, 6);
      check.expectGt("a deeper maze holds more predators", count4, count1);
      check.expectClose(
        "sonar range is 9 tiles at depth 1",
        s1.sonar.range,
        9,
        1,
      );
      check.expectLt(
        "sonar range shrinks at greater depth",
        s4.sonar.range,
        s1.sonar.range,
      );
      check.expectGe("sonar range never drops below 5", s4.sonar.range, 5);
      check.expectClose(
        "predator speed does not change with depth",
        speed4,
        speed1,
        3,
      );
    },
  };
}
