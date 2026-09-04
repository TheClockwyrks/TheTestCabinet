// audio/bed-loops-on-select — the bed keeps looping on a select screen, in both
// modes.
//
// THE RULE. "`music` is looping on every frame the game runs, on `title`,
// `howto`, `select`, and `editor` alike, in every sim status" (`specs/ui.md`,
// Audio). The sentence that closes the same paragraph settles the second half of
// this point: "The cues are the same in both modes" — so the campaign's select
// screen and the Extras' select screen are one requirement, and a build that ran
// the bed under one course and not the other breaks it.
//
// THE WORLD. The title screen with the audio unlocked and the bed up, then
// `setMode` and `setScreen("select")` — "Shows the current mode's select screen,
// `selectIndex` at that mode's `last`" (`specs/instrumentation.md`) — read once
// under `campaign` and once under `extras`. Nothing is placed and no run is live
// on either, so the bed is the only thing on the screen that can sound.
//
// THE VERDICT. Over every frame of each mode's select screen the build is running
// the bed, and each window was read on `select` under the mode it named.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";
import { screensOf, watchBed } from "./bed";
import { openSilence } from "./silence";

/** Frames each mode's select screen is read over. */
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

it("keeps the bed running on every frame of both modes' select screens", async () => {
  await openTitle(h);
  await openSilence(h);

  await openSelect(h, "campaign");
  const campaign = await h.snapshot();
  assertEqual(
    campaign.screen,
    "select",
    "the campaign's select screen is open",
  );
  assertEqual(campaign.mode, "campaign", "under the campaign course");
  assertNull(
    campaign.sim,
    "no run is live on a select screen, so the bed is the only thing that can sound",
  );
  const first = await watchBed(h, FRAMES);

  await captureStill(h, "select");

  await openSelect(h, "extras");
  const extras = await h.snapshot();
  assertEqual(extras.screen, "select", "the Extras' select screen is open");
  assertEqual(extras.mode, "extras", "under the Extras course");
  const second = await watchBed(h, FRAMES);

  assertDeepEqual(
    first.stopped,
    [],
    "the bed is looping on every frame of the select screen in campaign mode",
  );
  assertDeepEqual(
    screensOf(first),
    ["select"],
    "and every frame of that window was a frame of the select screen",
  );
  assertDeepEqual(
    second.stopped,
    [],
    "the bed is looping on every frame of the select screen in extras mode too: the cues are the same in both modes",
  );
  assertDeepEqual(
    screensOf(second),
    ["select"],
    "and every frame of that window was a frame of the select screen",
  );
});
