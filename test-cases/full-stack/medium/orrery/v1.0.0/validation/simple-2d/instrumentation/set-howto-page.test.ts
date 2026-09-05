// instrumentation/set-howto-page — `setHowtoPage` turns the how-to to a page, and
// that page is the one drawn.
//
// THE RULE. `specs/instrumentation.md`, Navigation and progress:
// "`setHowtoPage(n)` | Sets the how-to's current page, `0` to `HOWTO_PAGES - 1`
// (`4`)." The snapshot reports it as `howtoPage`, and `specs/ui.md` says what a
// page is: "How to play, told in a player's words rather than as rules of a
// system, over `HOWTO_PAGES` (`5`) pages. `state.howtoPage` names the page shown...
// and the current page is indicated on screen", followed by the five pages, each
// about something none of the others is about — the sky, the machine, the tape,
// running, and finishing.
//
// SO THE READING IS THE PICTURE, NOT THE FIELD ALONE. A build that stored the
// number and drew the same screen whatever it held would satisfy a check that
// only read `howtoPage` back, so each posed page's screen is kept and every pair
// of them is compared: what is asked is that the two are not the same picture.
// Whether the five pages are five subjects told in a player's words is the
// reviewer's to judge from the captured still; the check decides only that turning
// the page draws something.
//
// SO THE PICTURES ARE COMPARED BY PLACE. The stage is divided into a coarse
// `GRID x GRID` lattice and two pages are compared cell by cell, a cell counting
// as differing when a pixel in it moved by more than `CHANNEL_EPSILON` — the level
// below which a sampling cannot tell a drawing from eight-bit channel rounding and
// the host's antialiasing, so anything the build drew differently clears it. What
// is asked is that at least one of the cells differs. Where the indicator sits,
// how big it is and how the copy is set are all the build's, and none of them is
// assumed.
//
// THE CONFIGURATION. The how-to, entered from the title, with the five pages posed
// in a deliberately jumbled order — `2`, `0`, `4`, `1`, `3` — so a build that
// merely advanced a page on every call, or clamped at an end, lands on the wrong
// one. Each page's picture is kept, and all ten pairs are then compared.
//
// THE VERDICT. Every posed page is reported, and no two of the five pages draw the
// same screen, so the page drawn is the page posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOWTO_PAGES, STAGE_H, STAGE_W } from "../constants";
import {
  CHANNEL_EPSILON,
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  pixelAt,
  type Harness,
  type PixelRect,
} from "../harness";

/** The five pages, posed out of order, so no build passes by advancing one. */
const ORDER = [2, 0, 4, 1, 3];

/** How coarsely the stage is divided when two pages are compared by place. */
const GRID = 8;

/** In how many cells of the lattice two pictures differ. */
function differingCells(a: PixelRect, b: PixelRect): number {
  if (a.width !== b.width || a.height !== b.height) return GRID * GRID;
  let cells = 0;
  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      const x0 = Math.floor((column * a.width) / GRID);
      const x1 = Math.floor(((column + 1) * a.width) / GRID);
      const y0 = Math.floor((row * a.height) / GRID);
      const y1 = Math.floor(((row + 1) * a.height) / GRID);
      let differs = false;
      for (let y = y0; y < y1 && !differs; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const left = pixelAt(a, x, y);
          const right = pixelAt(b, x, y);
          if (Math.abs(left[3] - right[3]) > CHANNEL_EPSILON) {
            differs = true;
            break;
          }
          if (left[3] === 0 && right[3] === 0) continue;
          if (
            Math.abs(left[0] - right[0]) > CHANNEL_EPSILON ||
            Math.abs(left[1] - right[1]) > CHANNEL_EPSILON ||
            Math.abs(left[2] - right[2]) > CHANNEL_EPSILON
          ) {
            differs = true;
            break;
          }
        }
      }
      if (differs) cells += 1;
    }
  }
  return cells;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the page it is turned to, for every page of the how-to", async () => {
  assertEqual(
    HOWTO_PAGES,
    ORDER.length,
    "every page from 0 to HOWTO_PAGES - 1 is posed",
  );

  await openTitle(h);
  await openHowto(h);

  const drawn = new Map<number, PixelRect>();
  for (const page of ORDER) {
    await h.debug.setHowtoPage(page);
    const posed = await h.snapshot();
    assertEqual(
      posed.howtoPage,
      page,
      `setHowtoPage(${page}) sets the how-to's current page to ${page}`,
    );
    assertEqual(
      posed.screen,
      "howto",
      "turning a page leaves the session on the how-to",
    );
    await h.advance(1);
    if (page === HOWTO_PAGES - 1) await captureStill(h, "page");
    drawn.set(page, await h.pixelRect(0, 0, STAGE_W, STAGE_H));
  }

  for (let a = 0; a < HOWTO_PAGES; a += 1) {
    for (let b = a + 1; b < HOWTO_PAGES; b += 1) {
      const left = drawn.get(a);
      const right = drawn.get(b);
      assertEqual(left !== undefined, true, `page ${a} was drawn`);
      assertEqual(right !== undefined, true, `page ${b} was drawn`);
      assertGreaterThan(
        differingCells(left as PixelRect, right as PixelRect),
        0,
        `page ${a} and page ${b} draw different screens rather than one screen twice`,
      );
    }
  }
});
