// screens/hud-sound-toggles — the HUD's SOUND control toggles muting.
//
// specs/screens.md gives the HUD's third control its job: "`SOUND` — Toggles
// muting, as `specs/audio.md` states." specs/controls.md fixes the rectangle it
// answers, `HUD_SOUND` at `{ x: 556, y: 680, w: 120, h: 36 }`, and
// specs/instrumentation.md reports the result as the snapshot's `muted`, the
// game's copy of the runtime's mute bit. No operation of the surface sets that
// bit, deliberately: it is reached the way a player reaches it, through this
// control.
//
// A TOGGLE IS BOTH DIRECTIONS, so both are driven: a build that mutes and cannot
// unmute has left the player no way back to the sound, and it is one requirement
// rather than two because a control that only fires once is not a toggle.
//
// THE READING IS RELATIVE TO WHAT THE GAME OPENED AT. Muting is a player
// preference the runtime owns and `reset` leaves it exactly as it stands
// (specs/instrumentation.md), so this point reads the bit before the first click
// and asks that each click INVERT it, rather than asserting an initial value the
// specification never fixes.
//
// A FRAME IS RUN AFTER EACH CLICK. specs/state.md carries `muted` as the game's
// copy of the runtime's bit, refreshed in every update, so a build that reports
// the flip at the click and one that reports it on the next update both pass, and
// a build that never flips fails either way. Nothing else in the scenario touches
// the sound.
//
// WHAT THIS DOES NOT DECIDE. That muting actually SILENCES the cues is
// `audio/mute-silences`, and that unmuting restores them is
// `audio/unmute-restores`. This point reads the control and the bit alone.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_SOUND } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the mute bit on a click inside HUD_SOUND, and flips it back on a second", async () => {
  openTable(h);
  await h.advance(1);
  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    "posing: the live table, which is the screen the HUD's controls belong to " +
      "(specs/screens.md)",
  );
  const started = opened.muted;

  clickControl(h, HUD_SOUND);
  await h.advance(1);
  const once = h.snapshot().muted;

  clickControl(h, HUD_SOUND);
  await h.advance(1);
  captureStill(h, "toggled");
  const twice = h.snapshot().muted;

  assertEqual(
    once,
    !started,
    "the mute bit after one click inside HUD_SOUND, which toggles muting " +
      `from the ${String(started)} the game opened at (specs/screens.md, ` +
      "specs/audio.md)",
  );
  assertEqual(
    twice,
    started,
    "the mute bit after a second click inside HUD_SOUND, which toggles it " +
      "back (specs/screens.md, specs/audio.md)",
  );
});
