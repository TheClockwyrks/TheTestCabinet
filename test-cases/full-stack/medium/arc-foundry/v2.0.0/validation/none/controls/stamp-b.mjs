// Automated validation for controls.stamp-b: pressing B during a build phase pulls the
// scrap-press, arming a blank rock on the cursor; it can then be placed.
//
// Only opening the run is arranged. Pulling the press and dropping the armed rock is the
// behavior under test, and key presses and clicks are control ops, so the whole sequence is the
// act — the clip shows the press pull and the drop, which is exactly what is asserted.

import { startBuild, snap, spawnControlled, SECOND } from "../_helpers.mjs";

// A moment after the drop, with a Spark walking, so the landed rock reads on a live board.
// A beat on the board BEFORE the key is pressed. These items are about what a KEY DOES, and a
// key press is instantaneous — so an act that opens on the press has already spent the only frame
// in which the board looked like it did beforehand, and the clip is entirely aftermath. The lead-in
// is what lets a reviewer see the state the accelerator changed.
const LEAD_TICKS = 1.5 * SECOND;
// How long to wait for a click-placed rock to land, in short real slices. See `act`.
const PLACE_TRIES = 12;
const PLACE_SETTLE_MS = 80;
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The board after the press and after the drop, read by `assert`.
  let s1;
  let s2;

  return {
    id: "controls.stamp-b",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      await api.advance(LEAD_TICKS); // the empty build phase, before the press is pulled

      await api.call("press", "KeyB");
      s1 = await snap(api);

      // The armed rock can then be placed with a click on a legal footprint.
      //
      // The board is read by WAITING for the candidate rather than by taking the next snapshot.
      // The debug API's `click` returns as soon as it has dispatched, and a build is free to
      // handle it asynchronously — one gates its click handler behind `await audio.resume()`, so
      // its own AudioContext is running before anything else happens, which is a sensible thing to
      // do on a first interaction. Nothing in `specs/instrumentation.md` requires a click to
      // resolve inside one round trip; only that clicking there places the held rock. A build that
      // genuinely places nothing still returns after the full budget, which no check times.
      await api.call("pointerMove", 120, 260);
      await api.call("click", 120, 260);
      for (let i = 0; i < PLACE_TRIES; i += 1) {
        s2 = await snap(api);
        if (s2.towers.some((t) => t.kind === "candidate")) break;
        await api.settle(PLACE_SETTLE_MS);
      }

      await spawnControlled(api, "spark");
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectOk("pressing B armed a rock (the press pulled)", !!s1.held && s1.held.active);
      check.expectGt("the armed rock is then placeable", s2.towers.filter((t) => t.kind === "candidate").length, 0);
    },
  };
}
