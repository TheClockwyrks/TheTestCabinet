// audio/cue-lift — a press that puts a run in the hand sounds a cue on the frame
// the run is lifted, and the quiet table around it stays silent.
//
// `specs/audio.md`'s cue table: `lift` is played when "A press lifts a run into
// the hand", and every cue "is played on the frame its event happens and at most
// once on that frame". `specs/controls.md` fixes when that frame is: a press on
// a face-up card in a column lifts "That card and every card below it in the
// column", and "The run enters the hand on the press itself, before the pointer
// has moved at all", so the frame the lift cue belongs to is the frame
// `snapshot().drag` first reports a run.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot, so this point separates a
// build that cues the lift from one that cues nothing, one that cues a frame
// late, and one that blips every frame.
//
// THE WORLD THIS POSES. An empty table but for one face-up card alone on column
// `0`, which is the smallest board a press can lift a run from. Nothing else on
// the table can raise any of the other nine cues.
//
// THE POINTER NEVER MOVES AFTER THE PRESS, so nothing here can resolve into a
// drop or a click: the run is still in the hand when the readings are taken, and
// `cue-drop` and `cue-reject` are the points that grade what a release does with
// it. The button is let go only after every reading and the still are taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  cardCenter,
  cards,
  columnCardTopLeft,
  createHarness,
  framesFor,
  mousePress,
  mouseRelease,
  openTable,
  poseColumn,
  watchCues,
  type Harness,
} from "../harness";
import { frameOf, framesApartFrom, soundsOn } from "./cues";

/** Quiet play driven before the press, so a per-frame blip fails before it. */
const QUIET_FRAMES = framesFor(0.3);

/** Quiet play driven after the lift, with the run held, so a late blip is caught. */
const SETTLE_FRAMES = framesFor(0.3);

/** The column the one card is posed on, and the card itself. */
const COLUMN = 0;
const CARD = "KS";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the run enters the hand, and on no other frame", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, cards(CARD));
  await h.armAudio();

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  // The card is alone in its column, so its drawn top-left is the column anchor
  // and any point inside its footprint resolves to it (`specs/table.md`).
  const at = columnCardTopLeft(COLUMN, 0, [true]);
  const press = cardCenter(at.x, at.y);

  await mousePress(h, press.x, press.y);
  const lifted = await frameOf(h, (snapshot) => snapshot.drag !== null);
  const onTheLift = soundsOn([...played], lifted.frame);

  await h.advance(SETTLE_FRAMES);
  const heard = [...played];
  const held = await h.snapshot();
  await captureStill(h, "lift");
  await mouseRelease(h);

  // A run really entered the hand, and it is the card that was pressed.
  assertEqual(lifted.hit, true, "the press to put a run in the hand");
  assertEqual(held.drag?.cards.length, 1, "the cards the press lifted");
  assertEqual(
    held.drag?.fromPile,
    "tableau",
    "the pile the run was lifted from",
  );

  assertGreaterThan(
    onTheLift,
    0,
    `sounds emitted on frame ${lifted.frame}, the frame the run entered the hand`,
  );
  assertDeepEqual(
    framesApartFrom(heard, [lifted.frame]),
    [],
    "the frames of every sound emitted away from the lift",
  );
});
