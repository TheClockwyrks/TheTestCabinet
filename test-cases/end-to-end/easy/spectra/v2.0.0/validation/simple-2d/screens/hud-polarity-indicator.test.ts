// Spectra — screens/hud-polarity-indicator: the indicator reports the ship's band.
//
// THE RULE. `specs/ui.md` gives the polarity indicator its content: "The ship's
// current band, in that band's color and shape accent, with its label from
// `BAND_LABELS` (`CYAN`, `MAGENTA`). It follows a flip in the frame the flip happens,
// and it always agrees with the band drawn on the ship." `specs/field.md` puts it in
// the BOTTOM HUD strip, `y` in `[HUD_BOTTOM_TOP, STAGE_H]` (`[656, 720]`), and leaves
// how it is composed and placed within that strip to the build.
//
// WHAT IS MEASURED. The strip with the ship on `cyan`, and the strip with the ship on
// `magenta`, and how much of it moved. `specs/ui.md` requires a colour, a shape accent
// AND a label, all three of which change with the band, so the two readings cannot be
// the same picture — and none of the three is assumed, because the palette, the
// accent and the type are the build's.
//
// WHY THE WHOLE STRIP. `specs/field.md` says "how each is composed and placed within
// its strip is yours", so a check that read a fixed box would be asserting a layout
// the specification leaves to the build. The strip is fixed; the strip is read.
// Nothing else in it can have moved: the lives, the score, the meter and the mute bit
// are all untouched between the two readings, and the ship itself is drawn at `SHIP_Y`
// (`600`), inside the play field and outside this strip.
//
// THE BAND IS POSED, NOT FLIPPED. `setShipBand` sets the band the ship holds and "starts
// no fire lockout" (`specs/instrumentation.md`), which is the state a flip leaves
// behind and nothing else; driving the flip KEY instead would let a build whose `b`
// binding is broken fail this point as well as `controls/flip-f`, which is that
// point's to decide. The reading is taken on the frame after the band moved, which is
// the tightest the canvas can be read at: a frame's render shows the state that frame
// ran with.
//
// THE CONTROL. A build is free to animate what it draws, so the strip's own
// frame-to-frame drift is measured first, with nothing posed between the two
// readings, and the change the band causes has to beat it.
//
// WHAT IS NOT ASSERTED. Anything about how the indicator LOOKS. What colour, accent
// or type the build chose, and how far apart its two bands read, are the reviewer's
// presentation rating; the reading here is that the strip was repainted when the band
// moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  readRegion,
  startPosed,
  type Band,
  type Harness,
} from "../harness";
import {
  BOTTOM_STRIP,
  PAINT_MIN,
  countMoved,
  driftOverOneFrame,
} from "./reading";

/** The band the ship starts every run on (specs/bands.md), and the other one. */
const FIRST_BAND: Band = "cyan";
const SECOND_BAND: Band = "magenta";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("repaints the bottom strip when the ship's band changes", async () => {
  startPosed(h);
  h.debug.setShipBand(FIRST_BAND);
  await h.advance(1);
  assertEqual(
    h.snapshot().ship.band,
    FIRST_BAND,
    "the ship is posed on the first band",
  );

  const drift = await driftOverOneFrame(h, BOTTOM_STRIP, PAINT_MIN);
  const onFirst = drift.reading;
  captureStill(h, FIRST_BAND);

  h.debug.setShipBand(SECOND_BAND);
  await h.advance(1);
  assertEqual(
    h.snapshot().ship.band,
    SECOND_BAND,
    "the ship is posed on the second band",
  );
  const onSecond = readRegion(h, BOTTOM_STRIP);
  captureStill(h, SECOND_BAND);

  assertGreaterThan(
    countMoved(onFirst, onSecond, PAINT_MIN),
    drift.count,
    "pixels of the bottom HUD strip repainted when the ship went from " +
      `${FIRST_BAND} to ${SECOND_BAND} — the polarity indicator shows the ` +
      "ship's CURRENT band, in that band's colour and shape accent, with its " +
      "BAND_LABELS label (specs/ui.md), and sits in that strip " +
      "(specs/field.md); the strip moved on its own across one frame in " +
      `${String(drift.count)} pixels`,
  );
});
