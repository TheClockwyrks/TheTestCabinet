// controls.pause-key: Escape and P each pause a live dive.
//
// The old script proved the second key by starting a whole second dive, which `act`
// cannot do — `reset` would take the clock back mid-phase and freeze the recording. It
// does not need to: Escape is a TOGGLE (the pause action returns a paused dive to play),
// so the same live dive is paused with Escape, resumed with Escape, and paused again
// with P. Each screen is read the instant the key is pressed, exactly as before; the
// stretches in between are spent on the pause menu, where nothing can catch the forager
// and so nothing about the verdict can drift.
import { startPlaying } from "../_helpers.mjs";

export default function item() {
  let escScreen;
  let pScreen;

  return {
    id: "controls.pause-key",

    async arrange(api) {
      await startPlaying(api);
    },

    async act(api) {
      await api.call("press", "Escape");
      escScreen = (await api.snapshot()).screen;

      // Hold on the pause menu so the clip reads, then toggle back to live play.
      await api.advance(36); // 36 ticks = 0.3 s on the menu
      await api.call("press", "Escape");

      await api.call("press", "KeyP");
      pScreen = (await api.snapshot()).screen;

      await api.advance(84); // 84 ticks = the old 700 ms live tail
    },

    async assert(api, check) {
      check.expectEq("Escape pauses a live dive", escScreen, "paused");
      check.expectEq("P pauses a live dive", pScreen, "paused");
    },
  };
}
