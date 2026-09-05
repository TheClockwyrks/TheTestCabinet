// audio/music-cue-plays — the music bed starts when a round begins, and not
// before.
//
// WHAT THE SPECIFICATION FIXES. `specs/ui.md` names the event: `music` plays when
// "a round begins", and the bed "loops under the round it began with".
// `specs/mode.md` makes the first item of the title menu the mode's own entry,
// and `specs/ui.md` says what accepting it does: "`confirm` on it starts a
// round, which sets `screen` to `playing` with the board laid out as
// `specs/board.md` states."
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
// WHAT IS OBSERVED. Which cue sounded, by name. `specs/assets.md` binds each cue
// to its produced file through the engine's cue bus and the build plays each by
// the name `specs/ui.md` fixes, so a build that plays one of the three event cues
// at the start of a round does not pass this by making a noise. What is read is
// the ask the cue bus announces rather than a sound: this process has no Web
// Audio context, so no produced file is decoded here.
//
// WHAT IS ASSERTED, IN ONE DIRECTION. That no music sounded over a stretch of
// frames on the title, and that music sounded once the round had begun. It is not
// asserted that the bed plays exactly once, nor that it loops: "at most once on
// that tick" is `specs/ui.md`'s rule for the three EVENT cues, and the bed's own
// looping is a property of the sound running rather than of the frame it started
// on.

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

afterEach(() => {
  h?.dispose();
});

it("starts the music bed when the round begins, and not on the title", async () => {
  openTitle(h);

  // Watched from the title, so the quiet stretch below is read on the same log
  // the round's own cues arrive on.
  const cues = watchCues(h);
  await h.advance(secondFrames(TITLE_SECONDS));
  const onTitle = [...cues];

  const started = await captureReplay(h, "music", async () => {
    // `confirm` on the first item, which `specs/ui.md` makes the mode's entry.
    await chooseItem(h, 0);
    const begun = h.snapshot();
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
