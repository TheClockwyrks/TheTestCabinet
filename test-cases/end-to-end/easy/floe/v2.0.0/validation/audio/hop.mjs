// Automated validation for the Audio item `hop`: a short cue plays when the critter
// hops. Audio is synthesized with the Web Audio API (specs/ui.md), so the driver
// reports every source the build starts (see `api.audio`). Audio is armed with a real
// gesture first (the game must not autoplay before the player interacts), then one
// real hop is driven from a safe pocket and the audio log must grow across it — the
// build played a cue. Nothing here inspects the sound itself; only that one was
// scheduled in response to the hop.

import { hopPocket, armAudio, audioCount, HOP_TICKS } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;
  let moved;

  return {
    id: "audio.hop",

    async arrange(api) {
      await hopPocket(api);
      await armAudio(api);
    },

    async act(api) {
      const start = (await api.snapshot()).critter;
      before = await audioCount(api);
      await api.call("press", "ArrowLeft"); // onto cleared ice — a safe, solid tile
      await api.advance(HOP_TICKS);
      after = await audioCount(api);
      const end = (await api.snapshot()).critter;
      moved = end.col !== start.col || end.row !== start.row;
    },

    async assert(api, check) {
      check.expectOk("the critter hops", moved);
      check.expectGt(
        "a cue plays on the hop (Web Audio sources started)",
        after,
        before,
      );
    },
  };
}
