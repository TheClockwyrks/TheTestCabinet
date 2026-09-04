// audio/mute-silences — with sound muted, the events that carry cues carry none,
// the game stays fully playable, and the snapshot reports muted throughout.
//
// `specs/audio.md`: "While sound is muted every cue is silent and the game stays
// fully playable." `specs/instrumentation.md` has `muted` as "the game's copy of
// the runtime's mute bit, refreshed in every update", and under this engine it
// gives the surface an operation that sets it: `setMuted(muted)`, "the same bit
// the HUD's `SOUND` control toggles and the same bit `snapshot` reports as
// `muted`".
//
// MUTE IS POSED, NOT CLICKED, AND THAT IS THE POINT'S OWN BOUNDARY. This item is
// about what a MUTED game sounds like, so the way it was muted must not be able
// to fail it: a build whose `SOUND` control is dead would otherwise fail this
// item, `screens/hud-sound-mutes` and `screens/hud-sound-unmutes` for one defect
// and say least about the one that is really broken. `setMuted` reaches the bit
// directly, so the only thing left for this point to decide is the silence.
//
// THE TABLE STARTS UNMUTED, WHICH IS THE PRECONDITION THAT MAKES THE READING MEAN
// ANYTHING. A build that opened already muted would be silent here for a reason
// that has nothing to do with muting, so the bit is read before the pose and
// after it, and the pose is what turns one into the other.
//
// THREE EVENTS, FROM THREE CORNERS OF THE CUE TABLE, so a build that silenced one
// path and not another is caught: a stock turn, a card carried to a foundation —
// which `specs/audio.md` has raise `lift`, `drop` AND `home` — and a fresh deal.
// Each is driven with the real mouse through the build's own controls, and each
// is confirmed to have HAPPENED, because a muted build that also stopped playing
// would be silent for the wrong reason.
//
// SILENCE IS READ TWO WAYS, and both have to hold. `watchCues` hears every sound
// attributed to a driven frame; `sounds()` counts every sound the page has
// emitted since it loaded, frames or not, which also catches a build that makes
// its noise straight from a DOM event handler outside the frame loop.
//
// WHAT "SILENT" IS TAKEN TO MEAN. A muted cue starts no sound at all. That is the
// reading `specs/audio.md`'s "every cue is silent" is held to here, and the one
// this review item states. A build that instead kept starting its sources at a
// gain of zero would be inaudible to a listener and would still fail this point;
// `audio-init.js` records that reading at length, and the stage report carries it
// as the one thing the specification could say more plainly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HUD_NEW_GAME_ITEM, type Suit } from "../constants";
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
  poseStock,
  menuPoint,
  rectCenter,
  watchCues,
  type Harness,
} from "../harness";
import { realClick, realDrop } from "./cues";

/** Quiet play driven after each event, so a late blip is still caught. */
const SETTLE_FRAMES = framesFor(0.3);

/** The suit every posed stock card carries. Nothing here reads it. */
const SUIT: Suit = "spades";

/** The Ace carried home, and the column it is lifted from. */
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

it("plays nothing at all on a turn, a card sent home or a deal while muted", async () => {
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
  await poseColumn(h, FROM, cards(CARRIED));
  await h.armAudio();

  // The bit a fresh page reports before anything mutes it. `reset` leaves it
  // exactly as it stands (`specs/instrumentation.md`), and this page never has.
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "the mute bit a fresh page reports before setMuted is called",
  );

  await h.debug.setMuted(true);
  assertEqual(
    (await h.snapshot()).muted,
    true,
    "the mute bit after setMuted(true) (specs/instrumentation.md) — a pose " +
      "that does not land leaves this point nothing to read",
  );

  // Watched from here, so nothing before the toggle can be counted against it.
  const played = watchCues(h);
  const totalBefore = await h.sounds();

  // A stock turn.
  const turned = await realClick(
    h,
    rectCenter(dropRect("stock")),
    (snapshot) => snapshot.waste.length > 0,
  );
  await h.advance(SETTLE_FRAMES);
  const afterTurn = await h.snapshot();

  // A card lifted and carried home, which raises three of the ten cues at once.
  const at = columnCardTopLeft(FROM, 0, [true]);
  const home = await realDrop(
    h,
    cardCenter(at.x, at.y),
    rectCenter(dropRect("foundation", FOUNDATION)),
  );
  await h.advance(SETTLE_FRAMES);
  const afterHome = await h.snapshot();

  // A fresh deal, from the HUD's own control.
  const dealt = await realClick(
    h,
    await menuPoint(h, HUD_NEW_GAME_ITEM),
    (snapshot) => snapshot.tableau[snapshot.tableau.length - 1].length > 0,
  );
  await h.advance(SETTLE_FRAMES);
  const afterDeal = await h.snapshot();

  const totalAfter = await h.sounds();
  await captureStill(h, "muted");

  // Each event really happened: the game stayed fully playable while muted.
  assertEqual(
    turned.hit,
    true,
    "the click on the stock to turn cards onto the waste",
  );
  assertEqual(home.lifted, true, "the press to lift the Ace off its column");
  assertEqual(
    home.snapshot.foundations[FOUNDATION].length,
    1,
    "the cards on the foundation the Ace was carried to",
  );
  assertEqual(dealt.hit, true, "the click on NEW GAME to deal a fresh game");

  // And the bit held throughout, event by event.
  assertEqual(afterTurn.muted, true, "the mute bit after the stock turn");
  assertEqual(afterHome.muted, true, "the mute bit after the card went home");
  assertEqual(afterDeal.muted, true, "the mute bit after the deal");

  assertLength(played, 0, "the sounds emitted on any frame of the muted drive");
  assertEqual(
    totalAfter - totalBefore,
    0,
    "the sounds the page emitted across the muted drive, frames or not",
  );
});
