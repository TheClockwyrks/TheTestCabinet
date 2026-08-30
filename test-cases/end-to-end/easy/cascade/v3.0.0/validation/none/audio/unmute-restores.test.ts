// audio/unmute-restores — once sound has been muted and unmuted again, the cues an
// event raises are audible on the frame that event happens.
//
// `specs/audio.md`: "While sound is muted every cue is silent ... and turning
// mute off makes the same cues audible again." `specs/screens.md` fixes the
// control that does both, the HUD's `SOUND`, which "Toggles muting", and
// `specs/instrumentation.md` gives the surface no operation that sets the bit —
// so both halves of the round trip are driven as a player drives them, by real
// clicks inside the `HUD_SOUND` rectangle, and the bit is read back off the
// snapshot.
//
// THIS POINT DECIDES ONE DIRECTION: THE AUDIBLE ONE. That a muted cue is silent
// is `audio/mute-silences`, and this point deliberately does not re-decide it. A
// build that never mutes at all is unmuted throughout, sounds its cues, and
// passes here while failing its sibling, which is what one requirement in one
// direction means. What fails HERE is a build that mutes and cannot come back:
// one whose second click leaves the bit set, and one whose bit clears while its
// audio stays dead.
//
// THE EVENT IS A CARD CARRIED HOME, and it is chosen to lean on the ten cues as
// lightly as a point in this group can. `specs/audio.md` has an accepted drop
// onto a foundation raise BOTH `drop` and `home` on one frame, so the frame this
// point listens to is silent only for a build that plays neither — a build
// missing one cue loses that cue's own point and keeps this one. `audio/cue-drop`
// and `audio/cue-home` are the points that grade the two cues themselves.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { HUD_SOUND } from "../constants";
import {
  captureStill,
  cardCenter,
  cards,
  columnCardTopLeft,
  createHarness,
  dropRect,
  framesFor,
  mousePress,
  mouseRelease,
  openTable,
  poseColumn,
  rectCenter,
  watchCues,
  type Harness,
} from "../harness";
import { framesApartFrom, realDrop, soundsOn } from "./cues";

/** Quiet play driven before the press, so a per-frame blip fails before it. */
const QUIET_FRAMES = framesFor(0.3);

/** Quiet play driven after the drop, so a blip a frame late is still caught. */
const SETTLE_FRAMES = framesFor(0.3);

/**
 * Frames driven after each click on the SOUND control.
 *
 * Not a tolerance: `specs/instrumentation.md` has `muted` refreshed in every
 * update, so one frame after the release is already enough to read the bit the
 * runtime holds. This is a handful, so the reading is of a settled game rather
 * than of the frame the click landed on.
 */
const TOGGLE_FRAMES = framesFor(0.05);

/** The Ace carried home, the column it is lifted from, and the foundation it lands on. */
const CARRIED = "AS";
const FROM = 0;
const FOUNDATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame a card reaches its foundation once mute has been turned off again", async () => {
  await openTable(h);
  await poseColumn(h, FROM, cards(CARRIED));
  await h.armAudio();

  // Muted, then unmuted, through the one control that does both. Neither click
  // is listened to: what this point is about is the cue AFTER the round trip.
  const sound = rectCenter(HUD_SOUND);
  for (let click = 0; click < 2; click += 1) {
    await mousePress(h, sound.x, sound.y);
    await mouseRelease(h);
    await h.advance(TOGGLE_FRAMES);
  }

  // The precondition that makes the reading mean anything: sound is back on.
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "the mute bit after the SOUND control has been clicked twice",
  );

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const at = columnCardTopLeft(FROM, 0, [true]);
  const home = await realDrop(
    h,
    cardCenter(at.x, at.y),
    rectCenter(dropRect("foundation", FOUNDATION)),
  );
  const onTheDrop = soundsOn([...played], home.dropFrame);

  await h.advance(SETTLE_FRAMES);
  const heard = [...played];
  await captureStill(h, "unmuted");

  // The Ace really reached its foundation, through the build's own rules.
  assertEqual(home.lifted, true, "the press to lift the Ace off its column");
  assertEqual(
    home.snapshot.foundations[FOUNDATION].length,
    1,
    "the cards on the foundation the Ace was carried to",
  );

  assertGreaterThan(
    onTheDrop,
    0,
    `sounds emitted on frame ${home.dropFrame}, the frame the Ace was accepted with sound back on`,
  );
  assertDeepEqual(
    framesApartFrom(heard, [home.liftFrame, home.dropFrame]),
    [],
    "the frames of every sound emitted away from the lift and the drop",
  );
});
