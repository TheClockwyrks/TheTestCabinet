// screens/hud-sound-toggles — the HUD's SOUND control toggles muting, both ways.
//
// THE RULE. specs/screens.md's HUD table: `HUD_ITEMS[2]`, `SOUND`, in the
// `HUD_SOUND` rectangle, "toggles muting, as specs/audio.md states".
// specs/audio.md: "The HUD's `SOUND` control toggles the engine's mute bit...
// turning mute off makes the same cues audible again." specs/instrumentation.md
// carries no operation that sets muting — "mute is reached the way a player
// reaches it, through the HUD's `SOUND` control, and the snapshot reports the
// result" as `muted`, the game's copy of the runtime's bit, refreshed in every
// update.
//
// A TOGGLE IS ONE REQUIREMENT AND IT HAS TWO ENDS. A control that mutes and cannot
// unmute has left the player with no sound and no way back, so both clicks are
// driven here and the second is read against the bit the first started from. Each
// reading is against the bit the build itself reported before that click, never
// against a fixed `true` or `false`: nothing in the specification fixes which way
// muting stands when a game opens, and a build that opens muted must be graded on
// the toggling rather than on the starting point.
//
// DRIVEN THROUGH THE ENGINE'S OWN POINTER, and read after the frame that carried
// it. Muting belongs to the engine's audio bus, and under this engine a debug pose
// is a pure `(state, ...) => state` transform with no route to it, so the click is
// dispatched as a real press and release at the rectangle's center and the frame
// that delivers them is what carries the change through to the bus
// ({@link tapPointer}, `harness.ts`).
//
// WHAT THIS DOES NOT DECIDE. That muting actually SILENCES the game, which is
// `audio/mute-silences`, nor that the `SOUND` label is drawn in its rectangle,
// which is `presentation/hud-labels-drawn`.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_SOUND } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  tapPointer,
  type Harness,
} from "../harness";

/** A point inside `HUD_SOUND`: its center (specs/controls.md). */
const PRESS = {
  x: HUD_SOUND.x + HUD_SOUND.w / 2,
  y: HUD_SOUND.y + HUD_SOUND.h / 2,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips muted on the first click inside SOUND and back on the second", async () => {
  openTable(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the game is in live play, where HUD_SOUND answers " +
      "(specs/controls.md: a control answers only on the screen it belongs to)",
  );

  const opened = h.snapshot().muted;
  await tapPointer(h, PRESS.x, PRESS.y);
  const afterFirst = h.snapshot().muted;

  await tapPointer(h, PRESS.x, PRESS.y);
  captureStill(h, "toggled");
  const afterSecond = h.snapshot().muted;

  assertEqual(
    afterFirst,
    !opened,
    `the mute bit the snapshot reports after one click inside HUD_SOUND, ` +
      `having opened ${String(opened)} (specs/screens.md, specs/audio.md)`,
  );
  assertEqual(
    afterSecond,
    opened,
    "the mute bit the snapshot reports after a second click inside " +
      "HUD_SOUND, which turns muting back off again (specs/audio.md)",
  );
});
