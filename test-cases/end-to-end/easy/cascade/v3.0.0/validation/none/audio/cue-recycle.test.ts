// audio/cue-recycle — turning an empty stock recycles the waste and sounds a cue
// on the frame the recycle happens, and the quiet table around it stays silent.
//
// `specs/audio.md`'s cue table: `recycle` is played when "A turn of an empty
// stock recycles the waste", and every cue "is played on the frame its event
// happens and at most once on that frame". `specs/stock.md` fixes the event: "A
// turn of an empty stock recycles instead: every card on the waste returns to
// the stock face-down, in reverse order". `specs/controls.md` fixes the gesture,
// a click inside the stock's drop rectangle, which `specs/table.md` puts at
// `(STOCK_X, TOP_ROW_Y)`.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot.
//
// THE WORLD THIS POSES, AND WHY IT IS THE EDGE CASE'S OWN. An empty stock and a
// waste holding two cards, which is the one board on which a click on the stock
// recycles rather than turns. `cue-turn` poses the opposite board and grades the
// other event, so a build that sounds on a turn and not on a recycle fails
// exactly this point. The waste is posed with a set per card, because a waste
// holding cards its set memory does not reach shows none of them
// (`specs/stock.md`) and this point has no business reaching that state.
//
// THE PRESS FRAME IS REQUIRED TO BE SILENT. A press on the stock lifts nothing
// (`specs/controls.md`) and carries no cue, so the only frame of this drive that
// may sound is the one the recycle landed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  dropRect,
  framesFor,
  openTable,
  poseWaste,
  rectCenter,
  watchCues,
  type Harness,
} from "../harness";
import { framesApartFrom, realClick, soundsOn } from "./cues";

/** Quiet play driven before the click, so a per-frame blip fails before it. */
const QUIET_FRAMES = framesFor(0.3);

/** Quiet play driven after the recycle, so a late blip is still caught. */
const SETTLE_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the recycle happens, and on no other frame", async () => {
  await openTable(h);

  // The stock is left empty by `openTable`, which is the whole precondition the
  // recycle turns on. One set per card, so the memory reaches every card it holds.
  await poseWaste(h, cards("AS", "2S"), [1, 1]);
  await h.armAudio();

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const recycled = await realClick(
    h,
    rectCenter(dropRect("stock")),
    (snapshot) => snapshot.stock.length > 0,
  );
  const onTheRecycle = soundsOn([...played], recycled.frame);

  await h.advance(SETTLE_FRAMES);
  const heard = [...played];
  await captureStill(h, "recycle");

  // The recycle really happened: the cards went back to the stock.
  assertEqual(
    recycled.hit,
    true,
    "the click on the empty stock to recycle the waste into it",
  );

  assertGreaterThan(
    onTheRecycle,
    0,
    `sounds emitted on frame ${recycled.frame}, the frame the recycle happened`,
  );
  assertDeepEqual(
    framesApartFrom(heard, [recycled.frame]),
    [],
    "the frames of every sound emitted away from the recycle",
  );
});
