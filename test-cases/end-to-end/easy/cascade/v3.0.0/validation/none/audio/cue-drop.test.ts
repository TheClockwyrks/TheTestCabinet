// audio/cue-drop — a release whose run is accepted by the pile it resolved to
// sounds a cue on the frame the drop lands, and no frame of the drive but the
// lift and the drop sounds at all.
//
// `specs/audio.md`'s cue table: `drop` is played when "A drop is accepted by the
// pile it resolved to", and every cue "is played on the frame its event happens
// and at most once on that frame". `specs/controls.md` fixes the gesture and the
// frame: a release farther than `DRAG_THRESHOLD` from its press is a drop, it
// "resolves to the pile whose drop rectangle contains the center of the run's
// leading card", and a rectangle "of a pile that accepts the run" applies the
// move. `specs/tableau.md` is what makes this column accept it: a column whose
// lowest card is face-up of rank `r` and colour `c` accepts a run led by a card
// of rank `r - 1` and the other colour, so a red five lands on a black six.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot.
//
// THE WORLD THIS POSES. An empty table but for the card being carried and the
// card it lands on. The move lands on a COLUMN rather than on a foundation on
// purpose: `specs/audio.md` has "A drop accepted by a foundation raises both
// `drop` and `home`", so a foundation would put two cues on one frame and this
// point is about one of them. The column the run leaves is emptied by the move,
// and `specs/tableau.md` says a move that empties a column turns nothing, so no
// `flip` joins it either.
//
// THE LIFT FRAME IS ALLOWED TO SOUND, AND ONLY IT. A drop cannot happen without
// a press that lifted the run, and `specs/audio.md` requires that press to play
// `lift` — the cue `audio/cue-lift` grades. So the two frames this drive may
// sound on are the press's and the release's, and every other frame of it, the
// quiet play before, the glides between and the settle after, must be silent.

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

/** Quiet play driven after the drop, so a blip a frame late is still caught. */
const SETTLE_FRAMES = framesFor(0.3);

/** The run that is carried, and the card that accepts it. */
const CARRIED = "5H";
const TARGET_CARD = "6S";
const FROM = 0;
const ONTO = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the accepted drop lands, and on no frame but the lift's", async () => {
  await openTable(h);
  await poseColumn(h, FROM, cards(CARRIED));
  await poseColumn(h, ONTO, cards(TARGET_CARD));
  await h.armAudio();

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const at = columnCardTopLeft(FROM, 0, [true]);
  const dropped = await realDrop(
    h,
    cardCenter(at.x, at.y),
    // The column holds one card, so its drop rectangle is that card's footprint
    // at the column anchor (`specs/table.md`).
    rectCenter(dropRect("tableau", ONTO, [true])),
  );
  const onTheDrop = soundsOn([...played], dropped.dropFrame);

  await h.advance(SETTLE_FRAMES);
  const heard = [...played];
  await captureStill(h, "drop");

  // The drop really happened, and the game's own rules accepted it.
  assertEqual(dropped.lifted, true, "the press to put the run in the hand");
  assertEqual(
    dropped.resolved,
    true,
    "the release to take the run out of the hand",
  );
  assertEqual(
    dropped.snapshot.tableau[ONTO].length,
    2,
    `the cards on column ${ONTO} once the drop was accepted`,
  );
  assertEqual(
    dropped.snapshot.tableau[FROM].length,
    0,
    `the cards left on column ${FROM} once the run had gone`,
  );

  assertGreaterThan(
    onTheDrop,
    0,
    `sounds emitted on frame ${dropped.dropFrame}, the frame the drop was accepted`,
  );
  assertDeepEqual(
    framesApartFrom(heard, [dropped.liftFrame, dropped.dropFrame]),
    [],
    "the frames of every sound emitted away from the lift and the drop",
  );
});
