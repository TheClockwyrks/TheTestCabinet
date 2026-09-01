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
// WHAT IS NOT ASSERTED. That the indicator AGREES with the band drawn on the ship —
// the ship's own two readings are `presentation/ship-reads-band`'s — and that the two
// bands are told apart by colour at all, which is
// `presentation/cyan-magenta-distinct`'s.

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
import { BOTTOM_STRIP, countMoved, driftOverOneFrame } from "./reading";

/** The band the ship starts every run on (specs/bands.md), and the other one. */
const FIRST_BAND: Band = "cyan";
const SECOND_BAND: Band = "magenta";

/**
 * How far a pixel must move to count as repainted, as a Euclidean RGB distance out
 * of the `441` an RGB cube is across.
 *
 * The case's figure, since `specs/ui.md` states the rule and leaves the palette to
 * the build: `40` is about a tenth of the space, which is the least a player reads as
 * a different band at a glance, and far above the rounding two readings of one
 * unchanged pixel differ by.
 */
const REPAINT_MIN = 40;

/**
 * How many pixels of the strip the indicator must repaint.
 *
 * At the harness's default shape the canvas is the stage at one device pixel per
 * logical unit, so `64` pixels is an eight-by-eight mark — smaller than one glyph of a
 * `BAND_LABELS` label legible at the stage's `1280 x 720` (`specs/ui.md`), let alone
 * the colour and shape accent beside it.
 */
const REPAINT_MIN_PIXELS = 64;

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

  const drift = await driftOverOneFrame(h, BOTTOM_STRIP, REPAINT_MIN);
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
    countMoved(onFirst, onSecond, REPAINT_MIN),
    Math.max(drift.count, REPAINT_MIN_PIXELS),
    "pixels of the bottom HUD strip repainted when the ship went from " +
      `${FIRST_BAND} to ${SECOND_BAND} — the polarity indicator shows the ` +
      "ship's CURRENT band, in that band's colour and shape accent, with its " +
      "BAND_LABELS label (specs/ui.md), and sits in that strip " +
      "(specs/field.md); the strip moved on its own across one frame in " +
      `${String(drift.count)} pixels`,
  );
});
