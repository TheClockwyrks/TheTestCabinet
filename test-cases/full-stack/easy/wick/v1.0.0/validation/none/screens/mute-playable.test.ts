// screens/mute-playable — the game plays exactly the same with its sound muted.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "The game stays fully
// playable with sound muted." What "playable" is, is the rest of the
// specification, and this drives the four things a run is made of, each under
// the figure its own file fixes: `LIGHT THE LAMP` "Starts a fresh run ... and
// sets `screen = playing`" (specs/ui.md — "`title`"); the lamplighter walks at
// `MOVE_SPEED` (`180`) units per second, "each tick the position advances by
// the velocity times `TICK_DT`" (specs/world.md), which is `MOVE_STEP` (`3`)
// units a tick; "A `playing` tick that ends with `pendingLevelUps` above `0`
// runs to completion and then opens the overlay" and `confirm` accepts, after
// which "`screen` returns to `playing`" (specs/progression.md); and `pause`
// "pauses on `playing`; resumes on `paused`" (specs/controls.md). Muting itself
// is "the runtime's mute bit ... mirrored into `muted` every frame"
// (specs/ui.md), which every frame of the drive is read for.
//
// WHY THE WORLD IS POSED AS IT IS. The audio is armed with a real browser
// gesture first, on a key bound to nothing, so that the mute is a mute of a
// running sound rather than of silence, and `KeyM` is pressed on the title
// before the run is lit, so every frame that follows runs under it. The run is
// then started the way a player starts one and the driver switches are turned
// off from inside it, so the walk is the lamplighter's alone and no spawn,
// contact or firing moves a figure this reads. The level-up is queued through
// the surface and opened by a real tick, and the offer, the pause and the
// resume are all REAL keys through Chromium's input pipeline.
//
// THE TOLERANCE. `POSITION_TOL` (`1e-6`) on the walk, which is ten exact steps
// of `MOVE_STEP`; everything else — a screen name, a count of queued level-ups,
// and the mute bit — is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BINDINGS, MOVE_STEP, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  displacement,
  holdAll,
  holdKeys,
  openLevelUp,
  pressConfirm,
  pressMute,
  pressPause,
  type Harness,
} from "../harness";

/** The key that walks the lamplighter right: the first binding of `right`. */
const RIGHT_KEY = BINDINGS.right[0]!;

/** The ticks the walk is held. */
const WALK_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lights the lamp, walks, takes an offer, pauses and resumes, all under the mute", async () => {
  await h.armAudio();
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the mute is pressed on");
  const muted = await pressMute(h);
  assertEqual(muted.muted, true, "muted before the run is lit");

  await captureReplay(h, "playable", async () => {
    const started = await pressConfirm(h);
    assertEqual(
      started.screen,
      "playing",
      "the screen LIGHT THE LAMP left under the mute",
    );
    assertEqual(started.muted, true, "muted on the run's first tick");
    await holdAll(h);

    const before = await h.snapshot();
    const walked = await holdKeys(h, [RIGHT_KEY], WALK_TICKS);
    assertNear(
      displacement(before, walked).x,
      MOVE_STEP * WALK_TICKS,
      POSITION_TOL,
      "the lamplighter's walk under the mute",
    );
    assertEqual(walked.muted, true, "muted through the walk");

    const overlay = await openLevelUp(h, 1);
    assertEqual(
      overlay.screen,
      "levelup",
      "the screen the queued level-up opened under the mute",
    );
    const accepted = await pressConfirm(h);
    assertEqual(
      accepted.screen,
      "playing",
      "the screen the accepted offer left under the mute",
    );
    assertEqual(
      accepted.run.pendingLevelUps,
      0,
      "the level-ups queued after the acceptance",
    );

    const paused = await pressPause(h);
    assertEqual(paused.screen, "paused", "the screen KeyP left under the mute");
    const resumed = await pressPause(h);
    assertEqual(
      resumed.screen,
      "playing",
      "the screen the resume left under the mute",
    );
    assertEqual(resumed.muted, true, "muted at the end of the drive");
  });
});
