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
// it: `audio.mute-produces-no-sound` grades what muting does to the sound, which
// is a different requirement that a build can fail with a perfectly good key.
// That item is `engines = ["none"]`, because under an engine the mute bit and the
// cue bus are the engine's; `audio.mute-silences` carries the half that stays the
// build's here, which is that the game keeps running while muted.
//
// THE STARTING BIT IS READ, NOT ASSUMED. No specification file fixes what `muted`
// is on a freshly loaded build, and `reset` explicitly leaves it as it stands
// ("muting is a player preference the runtime owns"), so this check reads the bit
// the build starts with and requires the first press to invert it and the second
// to restore it. Requiring `false` first would be asserting a figure no spec
// states.
//
// A FRAME IS ALLOWED TO SETTLE AFTER EACH PRESS, BECAUSE THE ORDER INSIDE AN
// UPDATE IS THE BUILD'S. `specs/instrumentation.md` fixes that `muted` is "the
// game's own copy of the engine's mute bit, refreshed from `api.audio.muted()` in
// every update" — but not whether that refresh runs before or after the frame's
// mute edge is acted on. Both are conformant, and they differ by exactly one
// frame, so the reading is taken a frame after each press. What is asserted is
// unchanged either way: a build that never mutes still fails, and one that latches
// still fails the second press.
//
// THE KEY IS A REAL KEY, dispatched at the target the engine listens on, so the
// engine's binding of `KeyM` to `mute`, its press-edge detection, the build's
// reading of that action, and its mirroring of the engine's bit are every step
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

/**
 * Frames run after each press before the mirrored bit is read.
 *
 * One, and one is enough: a build that refreshes its copy at the top of `update`
 * publishes the frame's toggle on the NEXT update, so one settling frame covers
 * the later of the two conformant orders. Nothing else can move across it —
 * `startCrossing` has shut the four world gates and cleared the strait — and no
 * key is held, so no second edge can arrive.
 */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns muting on with KeyM and off again with a second press", async () => {
  startCrossing(h);
  await h.advance(SETTLE_TICKS);

  const live = h.snapshot();
  assertEqual(live.screen, "playing", "the pose opened a live crossing");
  const started = live.muted;

  // One press edge, which is how specs/controls.md reads mute, so exactly one
  // toggle can follow from it.
  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  const afterFirst = h.snapshot().muted;

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
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
