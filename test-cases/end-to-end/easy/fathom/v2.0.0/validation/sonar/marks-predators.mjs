// sonar.marks-predators: as the front sweeps over a Flarefish it marks it briefly
// visible (the Flarefish neither hears the ping nor lights up on its own, so a
// visible Flarefish after the pulse is the sonar mark).
//
// The Flarefish is posed out beyond the light in `arrange`; firing the pulse and watching
// the front sweep over it is the real sim, so it is `act` — and that sweep is the clip.
import {
  denAllExcept,
  findSonarSenseTiles,
  pred,
  quietBoard,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  let litBefore;
  let r;

  return {
    id: "sonar.marks-predators",

    async arrange(api) {
      const snap = await startPlaying(api);
      await denAllExcept(api, ["flarefish"]);
      const [target] = findSonarSenseTiles(snap, snap.forager, 1);
      await api.call("setPredator", "flarefish", {
        tx: target.tx,
        ty: target.ty,
        mode: "wander",
      });
      await quietBoard(api); // keep the stationary forager dark (g stays 0)
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05 s
      litBefore = pred(await api.snapshot(), "flarefish").lit;
      await api.call("clearCooldowns");
      await api.call("press", "Space");
      // 180 ticks = the old 1.5 s cap; poll 6 = the old 0.05 s sweep chunk.
      r = await api.until((s) => pred(s, "flarefish").lit === true, {
        max: 180,
        poll: 6,
      });
      await api.advance(108); // 108 ticks = the old 900 ms live tail
    },

    async assert(api, check) {
      check.expectOk(
        "the Flarefish is unseen before the pulse (beyond the light)",
        litBefore === false,
      );
      check.expectOk("the sonar front marks the Flarefish visible", r.hit);
    },
  };
}
