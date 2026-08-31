// presentation/wave-banner-is-drawn — the `WAVE N` banner is on the field while it
// runs, and gone when it has run out.
//
// THE RULE. `specs/ui.md`: "The `WAVE N` banner is drawn centred on the field while
// it runs, naming the wave about to start, as `specs/progression.md` states. It is
// not part of the persistent HUD, and nothing of it is drawn once the banner has run
// out." `specs/progression.md` gives it `WAVE_BANNER_TIME` (`1.5` seconds) and makes
// it the breather between one wave and the next. A banner that never shows leaves the
// player with no idea which wave they are on; one that never clears sits over the
// field for the rest of the game.
//
// WHAT IS READ. The runs of text the frame drew, near the field's centre. Two things
// are asked of them together: that something there says WAVE, and that something
// there carries the posed wave number. Together rather than as one string, because
// `specs/ui.md` fixes the banner's copy as `WAVE N` and leaves the typography to the
// build — a build that sets the word and the number as two runs, one over the other
// or one beside the other, has drawn the banner the specification asked for.
//
// THE WAVE POSED IS `7`, which appears nowhere else on a field posed like this: the
// score is `0`, the lives are `3` and the field is empty. And the near-the-centre
// window is what keeps the HUD out of the reading — `specs/ui.md` draws the HUD in
// the upper portion of the field and clear of its centre, so nothing of it can land
// in the window a banner "drawn centred on the field" lands in.
//
// THE SECOND READING IS TAKEN A WHOLE BANNER LATER, so a build whose banner clears
// on its own timer has cleared it and a build that leaves it up has not. Nothing
// else changes between the two: `startPlaying` shuts the wave gate, so the rocks
// `specs/progression.md` spawns as a banner ends never arrive to move the picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { STAR_X, STAR_Y, WAVE_BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  textDraws,
  ticksFor,
  type Harness,
  type TextDraw,
} from "../harness";
import { FAR_SHIP } from "./scene";

/** The wave posed for the reading. See the header for why this figure. */
const WAVE = 7;

/**
 * How far from the field's centre a run may be drawn and still be the banner, in
 * logical units.
 *
 * `specs/ui.md` draws the banner "centred on the field" and fixes no size, so the
 * window is generous enough to hold a banner set large or stacked over two lines —
 * a little under half the field each way — and still far too tight to reach the
 * upper portion the HUD is drawn in.
 */
const NEAR_X = 300;
const NEAR_Y = 200;

/** Ticks driven past the banner's own length before the second reading. */
const AFTER_TICKS = ticksFor(WAVE_BANNER_TIME) + ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** The runs of text drawn near the field's centre. */
function nearCentre(runs: readonly TextDraw[]): TextDraw[] {
  return runs.filter(
    (run) =>
      Math.abs((run.left + run.right) / 2 - STAR_X) <= NEAR_X &&
      Math.abs(run.y - STAR_Y) <= NEAR_Y,
  );
}

/** Whether the runs near the centre name the wave: the word, and the number. */
function namesTheWave(runs: readonly TextDraw[]): boolean {
  const middle = nearCentre(runs);
  return (
    middle.some((run) => /wave/i.test(run.text)) &&
    middle.some((run) => run.text.includes(String(WAVE)))
  );
}

it("names the wave at the field's centre while the banner runs and not once it has", async () => {
  await startPlaying(harness, { wave: WAVE });
  await harness.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  await harness.debug.setWaveBanner(WAVE_BANNER_TIME);

  const running = textDraws(await harness.frameCalls());
  await captureStill(harness, "banner");

  assertTrue(
    namesTheWave(running),
    `text naming wave ${WAVE} drawn near the field's centre while a ${WAVE_BANNER_TIME}-second banner runs (specs/ui.md); the runs drawn there were ${JSON.stringify(nearCentre(running).map((run) => run.text))}`,
  );

  await harness.advance(AFTER_TICKS);
  const spent = textDraws(await harness.frameCalls());

  assertTrue(
    !namesTheWave(spent),
    `nothing of the banner drawn near the field's centre once it had run out (specs/ui.md); the runs still drawn there were ${JSON.stringify(nearCentre(spent).map((run) => run.text))}`,
  );
});
