// Floe — controls/mute-m: `KeyM` toggles the mute bit, and toggles it back.
//
// `specs/controls.md` binds `KeyM` to the `mute` action, reads mute as a press
// edge — "each fires once per press however long the key is held" — and fixes what
// it does: "Toggle sound, from any screen." `specs/ui.md` states the same as the
// mute action toggling the engine's own mute bit on every screen, and
// `specs/instrumentation.md` puts the result in the snapshot as `muted`, reachable
// no other way: "Muting is reached the same way a player reaches it, through the
// mute action, and the surface carries no operation for it."
//
// BOTH DIRECTIONS, BECAUSE A TOGGLE IS TWO HALVES OF ONE RULE. A build whose
// `KeyM` latches mute on and never lets it off has implemented half a toggle, and
// it is the half a player notices; the item this file decides is worded for both
// presses, so both are here. Two presses is still ONE requirement in one direction
// — "this key toggles" — rather than two, and no other point in the suite grades
// it: `audio.mute-silences` grades what muting does to the sound, which is a
// different requirement that a build can fail with a perfectly good key.
//
// THE STARTING BIT IS READ, NOT ASSUMED. No specification file fixes what `muted`
// is on a freshly loaded build, and `reset` explicitly leaves it as it stands
// ("muting is a player preference the runtime owns"), so this check reads the bit
// the build starts with and requires the first press to invert it and the second
// to restore it. Requiring `false` first would be asserting a figure no spec
// states.
//
// NO FRAME IS ALLOWED TO SETTLE, BECAUSE UNDER THIS ENGINE THERE IS NOTHING TO
// SETTLE. `specs/instrumentation.md` fixes that here `muted` "is a live read of
// the engine's own mute bit at the call" rather than a copy the game refreshes in
// its update, so the bit the snapshot reports is the bus's own at the instant it
// is read. The frame `tap` runs is the frame that delivers the edge, so the
// reading straight after it is the reading of a bus the press has already reached.
//
// THE KEY IS A REAL KEY, dispatched at the event target the engine listens on, so
// the engine's binding of `KeyM` to `mute`, its press-edge detection, the build's
// reading of that action, and its call onto the engine's bus are every step
// between the key and the reported bit. The crossing under it is live and empty —
// `startCrossing` clears the strait and shuts the four world gates — so nothing
// but the two presses can move anything the check reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The key this point decides, named literally: it is the whole of the point. */
const KEY = "KeyM";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns muting on with KeyM and off again with a second press", async () => {
  startCrossing(h);

  const live = h.snapshot();
  assertEqual(live.screen, "playing", "the pose opened a live crossing");
  const started = live.muted;

  // One press edge, which is how specs/controls.md reads mute, so exactly one
  // toggle can follow from it.
  await h.tap(KEY);
  const afterFirst = h.snapshot().muted;

  await h.tap(KEY);
  const afterSecond = h.snapshot().muted;
  captureStill(h, "muted");

  assertEqual(
    afterFirst,
    !started,
    "the first KeyM press flips the mute bit (specs/controls.md)",
  );
  assertEqual(
    afterSecond,
    started,
    "and the second flips it back: mute is a toggle, not a latch (specs/controls.md)",
  );
});
