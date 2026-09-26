// presentation/fault-banner-legible — the words the fault display puts up are
// drawn over the frozen machine behind them.
//
// THE RULE. "While `sim.status` is `faulted`, the field shows the machine frozen
// at the cycle the fault stopped, the parts and motes `specs/simulation.md` names
// in the fault drawn visibly distinct from the rest, and a banner naming which of
// the `FAULTS` of `specs/simulation.md` stopped the run. The banner's wording is
// the build's own" (`specs/ui.md`, The fault display), under the same file's
// Presentation: "every piece of text a screen shows is legible against whatever
// sits behind it at the logical stage size `STAGE_W x STAGE_H` (`1280 x 720`)".
//
// THE WORDING BEING THE BUILD'S IS WHAT DECIDES HOW THE BANNER IS FOUND. Nothing
// in `specs/` fixes a phrase, a place or a size for it, so it cannot be looked up
// by what it says. Two things about it are fixed, and together they name it.
//
// IT IS ON THE FIELD. The sentence is "THE FIELD shows the machine frozen ...,
// and a banner naming which of the `FAULTS` ... stopped the run", and
// `specs/editor.md` "divides the stage into five regions", of which the field is
// `x` `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y` `HEADING_H` (`48`) to
// `TAPE_Y0` (`560`). So only the type drawn there is read. The words the other
// four regions carry — the heading's, the tray's, the readout's and the tape
// panel's — are `presentation/editor-text-legible`'s to decide, and a build whose
// readout went illegible must fail THAT point rather than this one.
//
// AND IT IS NEW. The field carries type while a run is live too, since "a row's
// identifier is drawn on its part on the field". So the field is read once with
// the run running and once with it frozen, and what this point decides is every
// line the frozen frame carries there that the live one did not. A line the two
// frames share is not read, which is also what keeps a line the banner has since
// covered out of the reading: a covered line is not shown to a player at all.
//
// THE CONFIGURATION. `BARE` opened with one arm on `(0, -4)` — high on the field,
// where a banner drawn across the top of the stage has the machine behind it —
// whose tape is blank at cell `0` and `advance` at cell `1`. Cycle `0` therefore
// rests, since "a blank cell is a rest on every part ... and never faults", and
// cycle `1`'s fetch raises `unmounted`, "`advance` or `recede` on a part not on a
// track". The two frames read are the end of cycle `0`, still running, and the
// halt itself. The field holds no other part and no mote, so the frozen machine
// behind the banner is that one arm.
//
// THE ONE-SHOT EFFECT IS WAITED OUT. `specs/assets.md` fires the fault effect at
// "the anchor hex of the part it names" when the fault names no mote, and every
// system it fixes is "authored one-shot ... so it decays to empty rather than
// settling into a steady state". The frozen run is given `SETTLE_SECONDS` of
// further game time before it is read — over which "nothing advances further"
// (`specs/simulation.md`, Faults) — so what stands behind the banner is the
// frozen machine rather than a burst of particles.
//
// EVERYTHING IS READ AT THE STAGE'S OWN SIZE, which is what `createHarness()`
// opens: `cssWidth` and `cssHeight` "default to the logical stage" and `dpr` to
// `1`, so a logical unit is a device pixel and the reading is taken at exactly
// the size the rule names.
//
// THE VERDICT. The halt puts at least one line on the FIELD that the live run did
// not carry there, and every such line carries paint standing off the ground
// behind it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { STAGE_H, STAGE_W, TICK_HZ } from "../constants";
import { at, FIELD_REGION, type Region } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  CHANNEL_EPSILON,
  meanRect,
  shareAwayFrom,
  openBareRun,
  textLines,
  type DrawCall,
  type Harness,
  type TextLine,
} from "../harness";

/** How much further game time the frozen run is given before it is read. */
const SETTLE_SECONDS = 5;

/** That span in whole frames of the harness's own clock. */
const SETTLE_FRAMES = SETTLE_SECONDS * TICK_HZ;

/** Where the one arm stands: high on the field, under a banner across the top. */
const ANCHOR = at(0, -4);

/** Its tape: a rest, then the `advance` that raises `unmounted` off a track. */
const TAPE = [null, "advance"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/* -------------------------------------------------------------------------- */
/* Reading that a line of type was drawn                                      */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` fixes no palette, no font and no background, so nothing about
// HOW a line is set can be read, and how well it reads is the reviewer's. What a
// check decides is that the line reached the frame: the build submitted the run,
// and the band of the stage it anchored that run in carries paint standing off
// the flat ground behind it — the band is not one colour, so something was drawn
// into it.

/** How far past the outermost anchors of a line its band reaches. */
const BAND_PAD = 80;

/** How far over the baseline the band reaches, and how far under it. */
const BAND_ABOVE = 18;
const BAND_BELOW = 6;

/**
 * The frame's lines of text, one per baseline, with the blank ones dropped.
 *
 * `specs/assets.md` puts every word on the stage on the frame as drawn text
 * and fixes no more — "Which typeface carries them is yours" — and letter
 * spacing is not portable, so a build is free to draw one line of copy as one
 * call, as a call per word, or as a call per glyph. What all of those share is
 * the baseline, so the lines are `drawing.ts`'s `textLines` — the shared
 * harness's logical runs gathered onto the baselines they share, the reading
 * the shared `drewText` matches screen copy along. A line that spells nothing
 * but whitespace put no ink on the stage and is not read.
 */
function linesOf(calls: readonly DrawCall[], region: Region): TextLine[] {
  return textLines(calls, region).filter((line) => line.text.trim() !== "");
}

/** Text with its case and its whitespace dropped, which is how a line is matched. */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, "");
}

/**
 * The band of the stage a line is read inside, clipped to `bounds`.
 *
 * A line's extent is what the recorder measured of its runs, and on a frame it
 * never measured only the anchors; where the glyphs sit around an anchor
 * depends on the alignment and the font, neither of which `specs/` fixes — so
 * the band is taken ABOUT that extent, wide enough that a run set to any
 * alignment puts glyphs inside it and shallow enough not to swallow the line
 * above.
 */
function bandOf(line: TextLine, bounds: Region): Region {
  const x = Math.max(bounds.x, line.left - BAND_PAD);
  const y = Math.max(bounds.y, line.y - BAND_ABOVE);
  return {
    x,
    y,
    w: Math.max(1, Math.min(bounds.x + bounds.w, line.right + BAND_PAD) - x),
    h: Math.max(1, Math.min(bounds.y + bounds.h, line.y + BAND_BELOW) - y),
  };
}

/** Decide whether one line was drawn into the band the frame anchored it in. */
async function assertDrawn(
  line: TextLine,
  bounds: Region,
  what: string,
): Promise<void> {
  const band = bandOf(line, bounds);
  const rect = await h.pixelRect(band.x, band.y, band.w, band.h);
  assertGreaterThan(
    shareAwayFrom(rect, meanRect(rect), CHANNEL_EPSILON),
    0,
    `${what} is drawn at the logical stage size ${STAGE_W} x ${STAGE_H}: the ` +
      `line reads ${JSON.stringify(line.text)}, and the band the frame ` +
      `anchored it in carries paint standing off the ground behind it`,
  );
}

it("puts up a banner naming the fault, drawn over the frozen machine", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ANCHOR.q, ANCHOR.r, 0, 1, [...TAPE])]),
  });

  await advanceCycles(h, 1);
  assertEqual(
    (await h.snapshot()).sim?.status,
    "running",
    "cycle 0's cell is blank, which is a rest that never faults, so the first " +
      "frame read is the same machine with no fault display over it",
  );
  // The field is where the fault display draws, so its lines are the ones read.
  const live = new Set(
    linesOf(await h.lastCalls(), FIELD_REGION).map((line) => squash(line.text)),
  );

  await advanceCycles(h, 1);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "banner");

  const halted = await h.snapshot();
  assertEqual(
    halted.sim?.status,
    "faulted",
    "cycle 1's `advance` on a part that is on no track raises a fetch fault, " +
      "which freezes the run",
  );
  assertEqual(
    halted.sim?.fault?.kind,
    "unmounted",
    "the fault the fetch raises for `advance` off a track is `unmounted`, which " +
      "is the one of the FAULTS the banner names",
  );

  const lines = linesOf(await h.lastCalls(), FIELD_REGION);
  const fresh = lines.filter((line) => !live.has(squash(line.text)));
  assertGreaterThan(
    fresh.length,
    0,
    "the fault display puts up a banner naming which of the FAULTS stopped the " +
      "run, which is words the field did not carry while the run was live; the " +
      `lines the frozen field drew are ${JSON.stringify(
        lines.map((line) => line.text),
      )}`,
  );
  for (const line of fresh) {
    await assertDrawn(line, FIELD_REGION, "the line the halt put on the field");
  }
});
