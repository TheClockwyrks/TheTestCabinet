// presentation/editor-text-legible — every line of type the editor's four
// display regions carry is drawn onto the stage.
//
// THE RULE, from Presentation in `specs/ui.md`: "every piece of text a screen
// shows is legible against whatever sits behind it at the logical stage size
// `STAGE_W x STAGE_H` (`1280 x 720`)". WHICH text the editor shows, and where, is
// `specs/editor.md`'s own layout table, and the four regions below are the four
// it puts words in:
//
//   | Heading | `x` `0` to `STAGE_W`, `y` `0` to `HEADING_H` (`48`) | The
//     challenge's name, the machine's current cost, and the editor's messages. |
//   | Tray | `x` `0` to `TRAY_REGION_W` (`224`), `y` `48` to `STAGE_H` | One slot
//     per available part. |
//   | Readout | `x` `READOUT_X0` (`1008`) to `STAGE_W`, `y` `48` to `TAPE_Y0`
//     (`560`) | The run's live figures. |
//   | Tape panel | `x` `224` to `STAGE_W`, `y` `560` to `STAGE_H` | One row per
//     arm and wheel. |
//
// and each of them is required to carry words: the tray's entries each "show the
// part's name and its cost from `PART_COSTS`"; "during a run the readout shows at
// least the status, the cycle count, the period, the speed, and each set's
// tally against the challenge's `target`"; and in the tape panel "each row is
// annotated with its tape length against the machine's period" beside the label
// that "spans `x` `224` to `304`".
//
// THE FIELD IS NOT READ. It is the fifth region, it carries no text this file
// names, and what a build draws over it — a panel, a banner — is the subject of
// its own points. A line drawn under an opaque panel is not shown to a player at
// all, so reading one would be reading something no requirement is about.
//
// THE CONFIGURATION. `BARE` opened with a machine of two arms, on `WEST` and
// `EAST`, carrying tapes of two different lengths, and a live run at the stage's
// own size — which is what `createHarness()` opens, since `cssWidth` and
// `cssHeight` "default to the logical stage" and `dpr` to `1`, so a logical unit
// is a device pixel and the reading is taken at exactly the size the rule names.
// The run is live because the readout's figures are the run's; the two tapes
// differ in length because a row's annotation is "its tape length against the
// machine's period", and two rows of one length would leave that annotation
// showing the same figure twice.
//
// THE VERDICT. Each of the four regions carries at least one line of type, and
// every line in each of them is drawn into the band the frame anchored it in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  HEADING_REGION,
  READOUT_REGION,
  TAPE_REGION,
  TRAY_REGION,
  type Region,
} from "../field";
import { armPart, solution } from "../formats";
import { BARE, EAST, WEST } from "../fixtures";
import {
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

/** The four regions `specs/editor.md` puts words in, under its own names. */
const WORDED: readonly { name: string; region: Region }[] = [
  { name: "the heading", region: HEADING_REGION },
  { name: "the tray", region: TRAY_REGION },
  { name: "the readout", region: READOUT_REGION },
  { name: "the tape panel", region: TAPE_REGION },
];

/** The two arms' tapes: two lengths, so the two rows' annotations differ. */
const WEST_TAPE = ["rotate-cw", "rotate-ccw"] as const;
const EAST_TAPE = ["rotate-cw"] as const;

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

it("draws every line the editor's heading, tray, readout and tape panel carry", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", WEST.q, WEST.r, 0, 1, [...WEST_TAPE]),
      armPart("arm", EAST.q, EAST.r, 0, 1, [...EAST_TAPE]),
    ]),
  });
  await h.advance(1);
  await captureStill(h, "editor");

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "editor",
    "the frame this point reads is the editor's",
  );
  assertEqual(
    posed.sim?.status,
    "running",
    "the run is live, which is when the readout shows the run's figures",
  );
  assertLength(
    posed.editor.parts,
    2,
    "the machine is the two arms, so the tape panel carries a row for each",
  );

  const calls = await h.lastCalls();
  for (const { name, region } of WORDED) {
    const lines = linesOf(calls, region);
    assertGreaterThan(
      lines.length,
      0,
      `${name} carries the words specs/editor.md's layout table gives it, so ` +
        "the frame drew at least one line of type inside its extent",
    );
    for (const line of lines) {
      await assertDrawn(line, region, `${name}'s line`);
    }
  }
});
