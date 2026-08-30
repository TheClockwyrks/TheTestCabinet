// audio/cue-turn — turning cards from the stock onto the waste sounds a cue on
// the frame the turn happens, and the quiet table around it stays silent.
//
// `specs/audio.md`'s cue table: `turn` is played when "A turn moves cards from
// the stock onto the waste", and every cue "is played on the frame its event
// happens and at most once on that frame". `specs/controls.md` fixes the
// gesture: a click "turns the stock, as `specs/stock.md` states, when the press
// point lies in the stock's drop rectangle", and `specs/table.md` puts that
// rectangle at `(STOCK_X, TOP_ROW_Y)`, `CARD_W x CARD_H`.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot.
//
// THE WORLD THIS POSES. An empty table but for a stock holding one card more
// than a turn takes, so the turn moves cards and leaves the stock holding some:
// nothing here can recycle, and `cue-recycle` is the point that grades that
// event. The count comes from the build's own `turnCount` rather than from a
// literal, because a turn moves one card under Draw One and three under Draw
// Three and this point is common to both.
//
// THE PRESS FRAME IS REQUIRED TO BE SILENT. `specs/controls.md`: "A press that
// lands on no card lifts nothing, and so does a press on the stock", and
// `specs/audio.md` gives such a press no cue. The stock is turned by the CLICK,
// so the only frame of this drive that may sound is the one the turn landed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import type { Suit } from "../constants";
import {
  captureStill,
  createHarness,
  dropRect,
  framesFor,
  openTable,
  poseStock,
  rectCenter,
  watchCues,
  type Harness,
} from "../harness";
import { framesApartFrom, realClick, soundsOn } from "./cues";

/** Quiet play driven before the click, so a per-frame blip fails before it. */
const QUIET_FRAMES = framesFor(0.3);

/** Quiet play driven after the turn, so a blip a frame late is still caught. */
const SETTLE_FRAMES = framesFor(0.3);

/** The suit every posed card carries. A turn cares about none of it. */
const SUIT: Suit = "spades";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the turn happens, and on no other frame", async () => {
  await openTable(h);

  // One card more than a turn takes, read off the build's own deal mode, so the
  // turn is a turn under either variant and never a recycle.
  const { turnCount } = await h.snapshot();
  await poseStock(
    h,
    Array.from({ length: turnCount + 1 }, (_, i) => ({
      suit: SUIT,
      rank: i + 1,
      faceUp: false,
    })),
  );
  await h.armAudio();

  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const turned = await realClick(
    h,
    rectCenter(dropRect("stock")),
    (snapshot) => snapshot.waste.length > 0,
  );
  const onTheTurn = soundsOn([...played], turned.frame);

  await h.advance(SETTLE_FRAMES);
  const heard = [...played];
  await captureStill(h, "turn");

  // The turn really happened, through the build's own click and turn rules.
  assertEqual(
    turned.hit,
    true,
    "the click on the stock to move cards onto the waste",
  );

  assertGreaterThan(
    onTheTurn,
    0,
    `sounds emitted on frame ${turned.frame}, the frame the turn happened`,
  );
  assertDeepEqual(
    framesApartFrom(heard, [turned.frame]),
    [],
    "the frames of every sound emitted away from the turn",
  );
});
