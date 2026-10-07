// audio/cue-reject — a release whose run is refused sounds a cue on the frame the
// run goes back, and no frame of the drive but the lift and the release sounds at
// all.
//
// `specs/audio.md`'s cue table: `reject` is played when "A drop returns its run
// to the pile it was lifted from", and every cue "is played on the frame its
// event happens and at most once on that frame". `specs/controls.md` fixes the
// outcome: a drop resolving to "the rectangle of a pile that refuses the run"
// returns the run to the pile it was lifted from. `specs/tableau.md` is what
// makes this column refuse it: a column accepts only a run led by a card of the
// colour OTHER than its lowest card's, so a red five offered to a red six is
// refused.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot.
//
// THE ONE THING THAT DIFFERS FROM `audio/cue-drop` IS THE COLOUR OF THE CARD
// BEING OFFERED TO. Everything else — the table, the card carried, the press,
// the glide, the release point — is the same, so a build that sounds on an
// accepted drop and says nothing when one is refused fails exactly this point
// and passes its sibling.
//
// THE LIFT FRAME IS ALLOWED TO SOUND, AND ONLY IT. A refused drop cannot happen
// without a press that lifted the run, and `specs/audio.md` requires that press
// to play `lift`. Every other frame of the drive must be silent.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  cardCenter,
  cards,
  columnCardTopLeft,
  createHarness,
  dropRect,
  framesFor,
  openTable,
  poseColumn,
  rectCenter,
  watchCues,
  type Harness,
} from "../harness";
import { framesApartFrom, realDrop, soundsOn } from "./cues";

/** Quiet play driven before the press, so a per-frame blip fails before it. */
const QUIET_FRAMES = framesFor(0.3);

/** Quiet play driven after the release, so a late blip is still caught. */
const SETTLE_FRAMES = framesFor(0.3);

/** The run that is carried, and the card that refuses it: both red. */
const CARRIED = "5H";
const TARGET_CARD = "6H";
const FROM = 0;
const ONTO = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the refused run goes back, and on no frame but the lift's", async () => {
  await openTable(h);
  await poseColumn(h, FROM, cards(CARRIED));
  await poseColumn(h, ONTO, cards(TARGET_CARD));
  await h.armAudio();

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const at = columnCardTopLeft(FROM, 0, [true]);
  const refused = await realDrop(
    h,
    cardCenter(at.x, at.y),
    rectCenter(dropRect("tableau", ONTO, [true])),
  );
  const onTheReject = soundsOn([...played], refused.dropFrame);

  await h.advance(SETTLE_FRAMES);
  const heard = [...played];
  await captureStill(h, "reject");

  // The release really resolved, and the game's own rules refused it: the run is
  // back where it was lifted from and the target kept what it held
  // (`specs/tableau.md`, "A refused move").
  assertEqual(refused.lifted, true, "the press to put the run in the hand");
  assertEqual(
    refused.resolved,
    true,
    "the release to take the run out of the hand",
  );
  assertEqual(
    refused.snapshot.tableau[ONTO].length,
    1,
    `the cards on column ${ONTO}, which refused the run`,
  );
  assertEqual(
    refused.snapshot.tableau[FROM].length,
    1,
    `the cards back on column ${FROM}, which the run was lifted from`,
  );

  assertGreaterThan(
    onTheReject,
    0,
    `sounds emitted on frame ${refused.dropFrame}, the frame the run was returned`,
  );
  assertDeepEqual(
    framesApartFrom(heard, [refused.liftFrame, refused.dropFrame]),
    [],
    "the frames of every sound emitted away from the lift and the refusal",
  );
});
