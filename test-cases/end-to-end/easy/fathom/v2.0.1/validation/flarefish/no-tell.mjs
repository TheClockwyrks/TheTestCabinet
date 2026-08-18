// flarefish.no-tell: no amber bulb and no ping — between flares its body is unrevealed
// unless your light or sonar reaches it (the sampled pixel is not amber).
//
// The blind pair is posed instantly (`arrange`); `act` lets the pose settle in the sim,
// gives the build a frame to paint, and reads the drawn pixel back.
import {
  denAllExcept,
  findOccludedPair,
  isAmber,
  pred,
  quietBoard,
  sampleColor,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let p;
  let col;

  return {
    id: "flarefish.no-tell",

    async arrange(api) {
      const snap = await startPlaying(api);
      const bp = findOccludedPair(snap); // near enough for the Kindle circle, LOS blocked
      await denAllExcept(api, ["flarefish"]);
      await api.call("setPredator", "flarefish", {
        tx: bp.pred.tx,
        ty: bp.pred.ty,
        mode: "wander",
      });
      await quietBoard(api, bp.forager);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      p = pred(await api.snapshot(), "flarefish");
      // A REAL pause (the old wait(120)) so the posed scene has been painted before the
      // canvas is sampled — an instant advance produces no frame.
      await api.settle(120);
      col = await sampleColor(api, p.x, p.y);
      await api.screenshot("notell");
    },

    async assert(api, check) {
      check.expectOk(
        "the Flarefish body is not lit between flares",
        p.lit === false,
      );
      check.expectOk("it is not flaring", p.flaring === false);
      check.expectOk(
        "it gives off no amber bulb (its spot is not amber)",
        isAmber(col) === false,
      );
    },
  };
}
