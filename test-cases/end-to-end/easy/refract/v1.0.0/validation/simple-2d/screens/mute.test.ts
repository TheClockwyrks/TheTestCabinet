// Refract — screens/mute: the mute action works from any screen, and the game
// stays fully playable with sound off.
//
// specs/ui.md "Audio": the game binds the `mute` action to the runtime's mute
// bit, toggles it from any screen, mirrors the bit into `state.muted` every
// frame, and stays fully playable with sound muted; specs/controls.md lists
// `mute` as read on every screen. So the flag is flipped twice — once from the
// title, once from playing — through the real key binding each time, and then,
// with the game posed muted, a trace is drawn and must land on the beam
// exactly as it would with sound on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  tapAction,
  traceRoute,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips muted from the title and from playing, and a muted game still accepts a trace", async () => {
  await resetTo(h);
  const onTitle = h.snapshot().muted;
  await tapAction(h, "mute");
  assertEqual(
    h.snapshot().muted,
    !onTitle,
    "the mute action flips snapshot.muted from the title (specs/ui.md)",
  );

  await loadBoard(h, GEO_3X3);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: loadBoard moves to playing (specs/instrumentation.md)",
  );
  const onPlaying = h.snapshot().muted;
  await tapAction(h, "mute");
  assertEqual(
    h.snapshot().muted,
    !onPlaying,
    "the mute action flips snapshot.muted from playing (specs/ui.md)",
  );

  // Two flips leave the flag where it rested; make sure it is MUTED for the
  // trace below, so what is exercised is play with the sound off.
  if (!h.snapshot().muted) await tapAction(h, "mute");
  assertEqual(
    h.snapshot().muted,
    true,
    "posing: the game is muted for the trace (specs/ui.md)",
  );

  traceRoute(h, [
    [0, 0],
    [1, 1],
  ]);
  await h.advance(1);
  captureStill(h, "muted");

  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "a muted game still accepts a trace (specs/ui.md: fully playable with " +
      "sound muted)",
  );
});
