// audio/music-cue-plays — the music bed starts when a round begins, and not
// before.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md` names the event: `music` plays when
// "a round begins. It loops under the game until the round ends." `specs/mode.md`
// makes the first item of the title menu the mode's own entry, and `specs/ui.md`
// says what accepting it does: "`confirm` on it starts a round, which sets
// `screen` to `playing` with the board laid out as `specs/board.md` states."
//
// WHY THIS ONE POINT PRESSES KEYS. Every other point in this project reaches its
// screen through `setScreen`, because a build with a broken menu and a correct
// tick must fail the menu points and pass the gameplay ones. This point cannot:
// its event is a ROUND BEGINNING, and `specs/instrumentation.md` is explicit that
// `setScreen` is not that — "moving to `playing` this way runs the tick over the
// board as it stands rather than laying out a fresh round." The only thing that
// begins a round is a menu accepting its entry, so that is the route, and the
// title is where the drive starts.
//
// WHAT IS OBSERVED. The sound itself, named from the file it came from —
// `specs/assets.md` fixes `assets/audio/music.wav` as the bed's file, and
// `audio-init.js` carries that name from the fetch through the decode to the
// source that plays it. So a build that plays one of the three event cues at the
// start of a round does not pass this by making a noise.
//
// WHAT IS ASSERTED, IN ONE DIRECTION. That no music sounded over a stretch of
// frames on the title, and that music sounded once the round had begun. It is not
// asserted that the bed plays exactly once, nor that it loops: "at most once on
// that tick" is `specs/ui.md`'s rule for the three EVENT cues, and the bed's own
// looping is a property of the sound running rather than of the frame it started
// on.
//
// Audio is armed with a real key press first, because a browser opens no audio
// context without a gesture; `UNBOUND_KEY` is bound to no action, so arming
// leaves the title exactly as it stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  chooseItem,
  createHarness,
  cuesNamed,
  openTitle,
  secondFrames,
  watchCues,
  type Harness,
} from "../harness";

/** Seconds spent sitting on the title, on which no music may sound. */
const TITLE_SECONDS = 0.5;

/** Ticks of the round driven after it begins, so the clip holds play. */
const ROUND_TICKS = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the music bed when the round begins, and not on the title", async () => {
  await h.armAudio();
  await openTitle(h);

  // Watched from the title, so the quiet stretch below is read on the same log
  // the round's own cues arrive on.
  const cues = watchCues(h);
  await h.advance(secondFrames(TITLE_SECONDS));
  const onTitle = [...cues];

  const started = await captureReplay(h, "music", async () => {
    // `confirm` on the first item, which `specs/ui.md` makes the mode's entry.
    await chooseItem(h, 0);
    const begun = await h.snapshot();
    await h.tick(ROUND_TICKS);
    return begun;
  });

  assertLength(
    cuesNamed(onTitle, CUES.music),
    0,
    `music cues sounded over ${TITLE_SECONDS} s on the title screen`,
  );

  // The drive reached a round: accepting the mode's entry opened `playing`.
  assertEqual(
    started.screen,
    "playing",
    "the screen after confirming the title menu's first item",
  );

  assertGreaterThanOrEqual(
    cuesNamed(cues, CUES.music).length,
    1,
    "music cues sounded once the round had begun",
  );
});
