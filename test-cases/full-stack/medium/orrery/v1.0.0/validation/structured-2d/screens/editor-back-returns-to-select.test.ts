// screens/editor-back-returns-to-select — `back` in the editor, with no run live,
// goes to the select screen of the course being played.
//
// THE RULE. "Opening a challenge from a select screen shows this editor with that
// challenge's tray, and `back` while editing returns to that select screen"
// (`specs/editor.md`, Entering and leaving). `specs/controls.md` gives `back` as
// "Leaves the current screen; during a run, stops it", and grants it to the
// editor while editing; the run's own `back` — "`back` stops the run and returns
// to editing from any status" — is a different press in a different status, and
// is `runs/back-returns-to-editing`'s point. THIS press is made with `sim` `null`,
// which is what "while editing" means.
//
// WHICH select screen it returns to is the course the game is on: "`state.mode`
// is `campaign` or `extras`, and decides which course the `select` and `editor`
// screens serve" (`specs/ui.md`, Screens). So the mode is read back after the
// press as well as the screen.
//
// THE POSE. Both modes, each on a fresh session, with that mode's first challenge
// opened in the editor through `openChallenge`, which "moves to the editor with
// an empty machine, empty histories, no run, and the tray derived from the
// challenge" (`specs/instrumentation.md`) — a challenge "like any other", to which
// "every rule of `specs/editor.md` ... applies unchanged". So there is no machine,
// no selection and no run for the press to be about: the editor is editing, and
// nothing else.
//
// THE VERDICT. `screen` is `select` after the press and `mode` is still the
// course that was open, so a build that left for the title, or for the other
// mode's list, is reported.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNull } from "../assert";
import { MODES } from "../constants";
import {
  backAction,
  captureStill,
  createHarness,
  openChallenge,
  openTitle,
  type Harness,
} from "../harness";

/** The row both modes open from the start. */
const ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the current mode's select screen on one back press, in both modes", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await h.debug.setMode(mode);
    await openChallenge(h, mode, ROW);

    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      "editor",
      `the press under test is made on the editor over a ${mode} challenge`,
    );
    assertEqual(posed.mode, mode, `the editor is serving the ${mode} course`);
    assertNull(
      posed.sim,
      "the editor is EDITING, with no run live for back to stop instead",
    );

    const after = await backAction(h);
    await captureStill(h, "select");

    assertNotEqual(
      after.screen,
      "editor",
      `back while editing a ${mode} challenge leaves the editor`,
    );
    assertEqual(
      after.screen,
      "select",
      `back while editing returns to the select screen rather than to the title`,
    );
    assertEqual(
      after.mode,
      mode,
      `the select screen returned to serves the ${mode} course the editor was on`,
    );
  }
});
