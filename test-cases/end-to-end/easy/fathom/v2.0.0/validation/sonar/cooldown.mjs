// sonar.cooldown: emitting a pulse starts a ~1.5 s cooldown before it is ready again.
//
// Entering play and clearing the cooldown is instant (`arrange`); firing and then waiting
// the ~1.5 s out is the check itself, so it is `act`.
import { startPlaying, SONAR_COOLDOWN, ticksFor } from "../_helpers.mjs";

export default function item() {
  let readyBefore;
  let s1;
  let readyAfter;

  return {
    id: "sonar.cooldown",

    async arrange(api) {
      await startPlaying(api);
      await api.call("clearCooldowns");
    },

    async act(api) {
      readyBefore = (await api.snapshot()).sonar.ready;
      await api.call("press", "Space");
      // 2 ticks for the old step(0.02) = 2.4 ticks: a "one moment later" beat so the
      // cooldown has been armed, not a measured duration.
      await api.advance(2);
      s1 = await api.snapshot();
      await api.advance(ticksFor(SONAR_COOLDOWN)); // 180 ticks = the 1.5 s cooldown
      readyAfter = (await api.snapshot()).sonar.ready;
      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectOk("sonar is ready before firing", readyBefore);
      check.expectOk(
        "sonar is on cooldown right after firing",
        s1.sonar.ready === false,
      );
      check.expectClose(
        "the cooldown is ~1.5 s",
        s1.sonar.cooldown,
        SONAR_COOLDOWN,
        0.2,
      );
      check.expectOk("sonar is ready again after the cooldown", readyAfter);
    },
  };
}
