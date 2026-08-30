// audio/cue-deal — dealing a fresh game sounds a cue on the frame the deal
// happens, and the quiet table before and after it stays silent.
//
// `specs/audio.md`'s cue table: `deal` is played when "A fresh game is dealt",
// and every cue "is played on the frame its event happens and at most once on
// that frame". `specs/screens.md` fixes the gesture that deals one during play:
// the HUD's `NEW GAME` control "Deals a fresh game and stays on `playing`", and
// `specs/controls.md` has a control answer "a click whose press point lies inside
// its rectangle".
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot, so this point separates a
// build that cues the deal from one that cues nothing, one that cues a frame
// late, and one that blips every frame, and leaves which of the ten sounds it
// played to the reviewer's ear.
//
// THE WORLD THIS POSES. `openTable` leaves an empty table on the `playing`
// screen: thirteen empty piles, no run in hand, nothing in flight. Nothing on
// that table can raise any of the other nine cues, so every sound the drive
// emits belongs to the deal. The table is driven for a third of a second BEFORE
// the click, so a build that blips per frame has somewhere to fail that is not
// the deal itself, and for a third of a second after it, so a late blip is
// caught too.
//
// THE PRESS FRAME IS REQUIRED TO BE SILENT AS WELL. `specs/audio.md` gives a
// press on a control no cue, and `specs/controls.md` makes a press inside a
// control's rectangle lift nothing, so the only frame of this drive that may
// sound is the one the deal landed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { HUD_NEW_GAME } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  rectCenter,
  watchCues,
  type Harness,
} from "../harness";
import { framesApartFrom, realClick, soundsOn } from "./cues";

/**
 * Quiet play driven before the click, in frames.
 *
 * A third of a second of a table that raises no event at all. It is not a
 * tolerance on anything: it is how much silence a build that blips per frame has
 * to get through before the deal it is allowed to sound on.
 */
const QUIET_FRAMES = framesFor(0.3);

/** Quiet play driven after the deal, so a blip a frame late is still caught. */
const SETTLE_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the deal happens, and on no other frame", async () => {
  await openTable(h);
  await h.armAudio();

  // Watched after the table is posed, so what is read is the drive alone.
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const dealt = await realClick(
    h,
    rectCenter(HUD_NEW_GAME),
    (snapshot) => snapshot.stock.length > 0,
  );
  const onTheDeal = soundsOn([...played], dealt.frame);

  await h.advance(SETTLE_FRAMES);
  const heard = [...played];
  await captureStill(h, "deal");

  // The deal really happened, by the build's own control and its own rules.
  assertEqual(
    dealt.hit,
    true,
    "the click on the HUD's NEW GAME control to deal a fresh game",
  );

  assertGreaterThan(
    onTheDeal,
    0,
    `sounds emitted on frame ${dealt.frame}, the frame the deal happened`,
  );
  assertDeepEqual(
    framesApartFrom(heard, [dealt.frame]),
    [],
    "the frames of every sound emitted away from the deal",
  );
});
