// Refract — screens/mute: the mute action flips `state.muted` from any screen,
// and the game stays fully playable with sound off.
//
// specs/ui.md "Audio": the game "binds the `mute` action to the runtime's mute
// bit and toggles it from any screen, then mirrors that bit into `state.muted`
// every frame", and "the game stays fully playable with sound muted";
// specs/controls.md lists `mute` among the registered actions, "read on every
// screen". So the flag is flipped by a real key on the title and again on
// playing — each press asserted as a FLIP of whatever the flag held, not as a
// landing on a fixed value — and then, with muting posed on, a trace is drawn
// and must take exactly as it would with sound.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { R3_REDRAW } from "../fixtures";
import {
  captureStill,
  createHarness,
  fireAction,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Fire `mute` once and assert the snapshot's flag flipped. */
async function flipMute(h: Harness, where: string): Promise<boolean> {
  const before = (await h.snapshot()).muted;
  await fireAction(h, "mute");
  const after = (await h.snapshot()).muted;
  assertEqual(after, !before, `one mute press flips muted ${where}`);
  return after;
}

it("flips muted on the title and on playing, and still accepts a trace", async () => {
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the game opens on the title",
  );
  await flipMute(h, "on the title");

  await loadBoard(h, R3_REDRAW);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "loadBoard moves to playing",
  );
  let muted = await flipMute(h, "on playing");

  // Pose muting ON for the playability half, whichever way the flips left it.
  if (!muted) muted = await flipMute(h, "posing sound off");
  assertEqual(muted, true, "muting is on for the trace");

  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  await h.advance(1);
  await captureStill(h, "muted");

  const played = await h.snapshot();
  assertEqual(played.muted, true, "still muted after the trace");
  assertDeepEqual(
    played.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the trace takes while muted",
  );
});
