// Refract — screens/mute: the mute action flips the muted flag from the title
// and from playing, and the game still accepts a trace while muted.
//
// specs/ui.md: `mute` is read on every screen — the game binds the action to
// the runtime's mute bit, toggles it from any screen, and mirrors that bit
// into `state.muted` every frame; and "the game stays fully playable with
// sound muted". So the flag is flipped once on the title and twice on the
// playing screen, read back off the snapshot after each press, and a segment
// is then traced while muted and must land exactly as it would with sound on.
// Every press is the `mute` action's own bound key, dispatched as a real key
// event at the target the engine listens on. The still is the muted game with
// its traced segment — playing on with sound off.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips muted from the title and from playing, and still accepts a trace", async () => {
  // From the title: one press flips the resting false to true.
  await resetTo(h);
  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().muted, false, "sound is on at the fresh title");
  await tapAction(h, "mute");
  assertEqual(h.snapshot().muted, true, "mute flips the flag from the title");

  // From playing: the flag flips back and forth under the same key.
  await loadBoard(h, GEO_3X3);
  assertEqual(h.snapshot().screen, "playing");
  assertEqual(h.snapshot().muted, true, "the flag carries onto playing");
  await tapAction(h, "mute");
  assertEqual(h.snapshot().muted, false, "mute flips the flag from playing");
  await tapAction(h, "mute");
  assertEqual(h.snapshot().muted, true, "and flips it back again");

  // Fully playable with sound off: a legal segment traces exactly as ever.
  h.debug.trace([
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "a trace lands while muted",
  );

  await h.advance(1);
  captureStill(h, "muted");
  assertEqual(h.snapshot().muted, true, "still muted on the rendered frame");
});
