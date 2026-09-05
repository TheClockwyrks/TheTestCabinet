// screens/select-lists-six-sites — the select screen lists the six sites in
// order, each row numbered from one.
//
// specs/ui.md § Site select: "`select` lists the `SITE_COUNT` (`6`) sites in
// order, each showing its number, its name, and its state... A site's displayed
// number is its index plus one, so the first site is index `0` and shows as `1`."
// This check decides that: six rows, in the order specs/sites.md authors them,
// each carrying its own name and its own number.
//
// THE SCREEN IS READ AS ROWS RATHER THAN AS A LIST OF STRINGS. How a row is laid
// out is the build's — a number and a name may be one run of text or three, and
// a state may sit beside them or under them — so each name the site table gives
// is found among the drawn text, and every other run of text on the screen is
// attributed to whichever of those names it was drawn nearest. A site's number
// then has to be among the figures of its own row, which is what "each showing
// its number" means whatever the layout.
//
// THE ORDER IS READ THE WAY A PLAYER READS IT: the six names sorted down the
// screen and then across it must come out in the site table's order.
//
// NOTHING IS CLEARED AND NOTHING IS POSED ON TOP, which is what keeps the reading
// clean: with no best score recorded, the only figures on any row are the row's
// own number (specs/ui.md gives a cleared site "its best score, cost and time,
// beside it").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { SITE_COUNT, SITE_NAMES } from "../constants";
import { createHarness, type Harness } from "../harness";
import { textDraws, toDrawCall, type TextDraw } from "../case-harness/index";

/**
 * Every run of text the last frame drew on the screen layer, with where it drew
 * it.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out in
 * logical stage units" — and the anchor each run was drawn at is what lets rows
 * be told from one another without knowing anything about the layout a build
 * chose.
 */
async function screenDraws(harness: Harness): Promise<TextDraw[]> {
  const ops = await harness.screenOps();
  return textDraws(ops.map(toDrawCall));
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * ASCII space is deliberately absent: a frame's text is assembled by joining
 * separate draw runs with one, so accepting it would read the two figures in
 * `40 130` as the single number 40130. `.` is absent for the same sort of
 * reason — it is the decimal point, and a build drawing `1.5` means one and a
 * half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One drawn number: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Every number a run of text carries, as figures rather than characters.
 *
 * A grouped figure reads as the one figure it is, so `1,234` and `1234` both
 * come back as 1234 and a build is free to group the figure it draws.
 */
function figuresIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((one) =>
    Number(one.replace(new RegExp(GROUP, "g"), "")),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lists the six sites in order, each row showing its index plus one", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(0);
  // The frame that follows the pose, which is the frame that draws it.
  await h.advance(1);
  await h.capture("site-list", "the six sites the select screen lists");

  const draws = await screenDraws(h);
  const drawn = draws.map((one) => one.text).join(" | ");

  // Each site's name, and the run of text that carries it.
  const rows = SITE_NAMES.map((name, index) => {
    const found = draws.find((one) =>
      one.text.toUpperCase().includes(name.toUpperCase()),
    );
    assertNotNull(
      found ?? null,
      `site ${index + 1}'s name, "${name}", among the text the select screen ` +
        `draws (specs/ui.md § Site select, specs/sites.md); it drew [${drawn}]`,
    );
    return found as TextDraw;
  });
  assertEqual(rows.length, SITE_COUNT, "the sites the select screen lists");

  // In order: down the screen, then across it.
  const read = [...rows].sort((a, b) => a.y - b.y || a.x - b.x);
  assertEqual(
    read.map((one) => one.text).join(" / "),
    rows.map((one) => one.text).join(" / "),
    "the six sites in the order specs/sites.md gives them, read down the " +
      "screen and then across it (specs/ui.md § Site select)",
  );

  // Every other run of text belongs to the row it was drawn nearest.
  for (const [index, row] of rows.entries()) {
    const own = draws.filter((one) => {
      const nearest = rows.reduce(
        (best, other) =>
          Math.abs(other.y - one.y) < Math.abs(best.y - one.y) ? other : best,
        rows[0] as TextDraw,
      );
      return nearest === row;
    });
    const figures = own.flatMap((one) => figuresIn(one.text));
    assertTrue(
      figures.includes(index + 1),
      `site ${index + 1}'s row to show its number, its index plus one ` +
        `(specs/ui.md § Site select); the row drawn with "${row.text}" shows ` +
        `[${own.map((one) => one.text).join(" | ")}]`,
    );
  }
});
