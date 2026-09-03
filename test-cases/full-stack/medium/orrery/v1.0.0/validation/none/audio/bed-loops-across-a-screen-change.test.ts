// audio/bed-loops-across-a-screen-change — a screen change neither stops the bed
// nor restarts it.
//
// THE RULE. "`music` is looping on every frame the game runs, on `title`,
// `howto`, `select`, and `editor` alike, in every sim status" (`specs/ui.md`,
// Audio), and it is "the one cue that loops UNTIL STOPPED rather than playing
// once". A bed that is stopped at a transition and started again on the next
// screen is not looping on every frame; it is playing once per screen, and the
// two are audibly different — the seam falls in the middle of the music.
//
// THE CROSSINGS. Title to select to editor and back to title, each made through
// the operation `specs/instrumentation.md` gives for it, each of which "Enters the
// screen exactly as the real transition into it enters it": `setScreen` for the
// select and the return, and `openChallenge`, which "moves the game to the editor
// with an empty machine, empty histories, no run". The return leg is the one that
// LEAVES the editor, where the same specification says the most happens — "a live
// run is stopped, the open challenge's machine is stashed, and the challenge is
// closed" — and it is exactly the transition a build is most likely to tear the
// bed down on.
//
// THE VERDICT, IN TWO READINGS. The bed is running on every frame of all four
// windows, and the count of LOOP STARTS — how many of the sounds the build emitted
// were looping when they began — is the same after the three crossings as before
// them. The first says the bed never went quiet; the second says it was never
// stopped and started again, which is the half a per-frame reading cannot see
// because a restart within one frame leaves no silent frame behind.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openChallenge,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";
import { screensOf, watchBed, type BedWindow } from "./bed";
import { openSilence } from "./silence";

/** Frames each of the four screens is read over. */
const FRAMES = 6;

let h: Harness;

beforeEach(async () => {
  // ARMED AT CREATION, because this suite reads what the build SOUNDED and a
  // browser opens no audio context without a user gesture: unarmed, `openSilence`
  // below would find the page's silence rather than the build's. The press of
  // `INERT_KEY` goes in before the harness's opening `reset`, whose restore puts
  // back anything it touched, so it costs this check nothing — see `silence.ts`.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("holds one unbroken bed across title, select, editor and back", async () => {
  await openTitle(h);
  await openSilence(h);

  const windows = await captureReplay(h, "crossing", async () => {
    const title: BedWindow = await watchBed(h, FRAMES);
    await openSelect(h, "campaign");
    const select: BedWindow = await watchBed(h, FRAMES);
    await openChallenge(h, "campaign", 0);
    const editor: BedWindow = await watchBed(h, FRAMES);
    await h.debug.setScreen("title");
    const back: BedWindow = await watchBed(h, FRAMES);
    return { title, select, editor, back };
  });

  assertDeepEqual(
    screensOf(windows.title).concat(
      screensOf(windows.select),
      screensOf(windows.editor),
      screensOf(windows.back),
    ),
    ["title", "select", "editor", "title"],
    "the drive crossed title to select to editor and back to title",
  );

  assertDeepEqual(
    windows.title.stopped,
    [],
    "the bed is looping on every frame of the title screen it started on",
  );
  assertDeepEqual(
    windows.select.stopped,
    [],
    "the crossing into the select screen did not stop the bed",
  );
  assertDeepEqual(
    windows.editor.stopped,
    [],
    "the crossing into the editor did not stop the bed",
  );
  assertDeepEqual(
    windows.back.stopped,
    [],
    "and leaving the editor for the title, which stops the run and closes the challenge, did not stop it either",
  );

  assertEqual(
    windows.back.loopsClosed,
    windows.title.loopsOpened,
    "no transition stops and restarts the bed: as many loops had been started after the three crossings as before them",
  );
});
