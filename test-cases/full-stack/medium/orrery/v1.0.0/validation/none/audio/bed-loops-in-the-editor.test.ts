// audio/bed-loops-in-the-editor — the bed keeps looping in the editor while
// editing, with no run live.
//
// THE RULE. "`music` is looping on every frame the game runs, on `title`,
// `howto`, `select`, and `editor` alike, in every sim status" (`specs/ui.md`,
// Audio). The editor while EDITING is the state this point reads: `specs/ui.md`'s
// table of what advances gives the editor "The run, while `sim.status` is
// `running`", so with no run live nothing at all is advancing here — and a bed
// that is driven by the simulation rather than by the frames stops.
//
// THE WORLD. The title screen with the audio unlocked and the bed up, then a
// challenge document opened, which leaves "the same editor state `openChallenge`
// leaves" — the editor over that challenge "with an empty machine, empty
// histories, no run, and the tray derived from the challenge"
// (`specs/instrumentation.md`). No machine is placed and no run is started, so
// nothing that could raise `place`, `erase`, `start`, `halt`, `constellation` or
// `complete` can happen and the bed is the only thing that can sound.
//
// THE VERDICT. Over every frame of the editor the build is running the bed, and
// every frame of the window was a frame of the editor with `sim` still `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  openTitle,
  type Harness,
} from "../harness";
import { screensOf, statusesOf, watchBed } from "./bed";
import { openSilence } from "./silence";

/** Frames the editor is read over. */
const FRAMES = 8;

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

it("keeps the bed running on every frame of the editor while editing", async () => {
  await openTitle(h);
  await openSilence(h);

  await openChallengeDocument(h, BARE);
  const editing = await h.snapshot();
  assertEqual(
    editing.screen,
    "editor",
    "the world this point reads is the editor screen",
  );
  assertNull(
    editing.sim,
    "with no run live, nothing is advancing and nothing but the bed can sound",
  );
  assertEqual(
    editing.editor.parts.length,
    0,
    "the machine is empty, so no edit and no run event can raise a cue of its own",
  );

  const window = await watchBed(h, FRAMES);

  await captureStill(h, "editor");

  assertDeepEqual(
    window.stopped,
    [],
    "the bed is looping on every frame of the editor screen while editing",
  );
  assertDeepEqual(
    screensOf(window),
    ["editor"],
    "and every frame it was read on was a frame of the editor",
  );
  assertDeepEqual(
    statusesOf(window),
    [null],
    "with no run live on any of them",
  );
});
