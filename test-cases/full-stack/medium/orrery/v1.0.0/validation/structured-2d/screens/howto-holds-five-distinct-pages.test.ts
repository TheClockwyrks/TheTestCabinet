// screens/howto-holds-five-distinct-pages — the how-to really holds
// `HOWTO_PAGES` pages: five of them, each a page of its own.
//
// THE RULE. "How to play, told in a player's words rather than as rules of a
// system, over `HOWTO_PAGES` (`5`) pages. `state.howtoPage` names the page shown"
// (`specs/ui.md`, `howto`), and the specification then lists the five in order:
// the sky, the machine, the tape, running, and finishing. Five pages that showed
// the same thing would be one page shown five times, so the count is a claim
// about what is DRAWN and not only about the range a counter runs over. What each
// page must SAY is two of the other items in this category; this one decides that
// the five exist and differ.
//
// THE POSE. A fresh session and the how-to, its page moved over `0` through
// `HOWTO_PAGES - 1` with `setHowtoPage` — "Sets the how-to's current page, `0` to
// `HOWTO_PAGES - 1` (`4`)" — and one frame drawn at each. Nothing else is posed
// and nothing else is driven: "`title`, `howto`, `select` — Nothing" advances
// (`specs/ui.md`, What advances on each screen), so the frame at a page is the
// same frame however long the screen is left standing, and the five pictures are
// comparable.
//
// HOW TWO PAGES ARE TOLD APART. By the pixels of the whole stage, which is the
// one reading that holds whatever a build draws its pages with — `specs/ui.md`
// "fixes no palette, no font, and no background", and beside the copy
// `specs/assets.md` draws as text a page may carry a picture of its own. Two
// pages are different when any device pixel of the stage differs; the comparison
// is `samePicture`, which counts a pixel as moved only past `CHANNEL_EPSILON`, so
// a build is not held to a byte.
//
// THE VERDICT. Every page from `0` to `HOWTO_PAGES - 1` is reached and reported
// as the page shown, and each of the ten pairs of pages is drawn differently from
// the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HOWTO_PAGES, STAGE_H, STAGE_W } from "../constants";
import {
  captureReplay,
  createHarness,
  openHowto,
  openTitle,
  samePicture,
  type Harness,
  type PixelRect,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws HOWTO_PAGES pages, each different from every other", async () => {
  await openTitle(h);
  await openHowto(h);

  const pages: PixelRect[] = [];
  const shown: number[] = [];
  await captureReplay(h, "pages", async () => {
    for (let page = 0; page < HOWTO_PAGES; page += 1) {
      await h.debug.setHowtoPage(page);
      await h.advance(1);
      shown.push((await h.snapshot()).howtoPage);
      pages.push(await h.pixelRect(0, 0, STAGE_W, STAGE_H));
    }
  });

  for (let page = 0; page < HOWTO_PAGES; page += 1) {
    assertEqual(
      shown[page],
      page,
      `howtoPage runs over every page of the how-to, page ${page} included`,
    );
  }

  for (let a = 0; a < HOWTO_PAGES; a += 1) {
    for (let b = a + 1; b < HOWTO_PAGES; b += 1) {
      assertTrue(
        !samePicture(pages[a] as PixelRect, pages[b] as PixelRect),
        `the how-to's page ${a} and page ${b} are drawn differently, so the ` +
          "screen holds HOWTO_PAGES pages rather than one page shown five times",
      );
    }
  }
});
