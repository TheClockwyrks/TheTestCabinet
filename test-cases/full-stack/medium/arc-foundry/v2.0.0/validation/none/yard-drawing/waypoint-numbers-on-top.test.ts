// yard-drawing/waypoint-numbers-on-top — the order numbers are drawn last.
//
// `specs/pathing.md`: "each waypoint is drawn with its order number, `1` through
// `6`, and those numbers are drawn last, over the structures and the units, so
// nothing on the yard obscures the chain". `specs/hud.md` puts "the waypoint
// order numbers, drawn over everything else" among what the yard draws, and
// `specs/overview.md` makes it something a player reads at a glance.
//
// THE CROWD. A component stood on the open tiles beside `WP1`'s platform and a
// unit held standing on the platform itself, which are the two things
// `specs/pathing.md` names. Both are drawn from produced sprites
// (`specs/assets.md`), so both are image blits landing on the yard, and the
// question is whether the numbers were issued after the last of them.
//
// WHAT IS READ. The order the frame's operations were issued in. Every number is
// found near the anchor of the platform it belongs to — `specs/yard.md` makes
// that anchor "the tile the Load paths to" — and every one of the six has to have
// been drawn after the last image the yard took, which is the substrate, the
// chain's own furniture, the component, and the unit alike.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  imageDraws,
  inRegion,
  openYard,
  parkUnit,
  standComponent,
  textDraws,
  YARD,
} from "../harness";
import { mapById, tileCenter } from "../constants";

const MAP = "substation";
/** How far a number may sit from its platform's anchor and still be its number. */
const NEAR = 40;

/**
 * The order number a text run reads as, or `null` when it is not one.
 *
 * `specs/pathing.md` fixes the NUMBER each waypoint is drawn with — `1` through
 * `6` — and fixes nothing about how it is set, so a build is free to pad it
 * (`01`), to label it (`WP1`, `#3`) or to draw the bare digit. What is compared
 * is therefore the FIGURE the run spells rather than its characters: `01` is
 * waypoint one, and `10` is not. A run carrying more than one figure is not a
 * waypoint's number and is left out, which is what keeps a readout like
 * `3 / 6` from standing in for one.
 */
function orderOf(text: string): number | null {
  const figures = text.match(/\d+/g);
  if (figures === null || figures.length !== 1) return null;
  return Number(figures[0]);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every waypoint number after the yard's last blit", async () => {
  const map = mapById(MAP);
  const first = map.waypoints[0]!;
  await openYard(h, { map: MAP, wave: 30 });

  // A structure on the open tiles beside WP1's platform, and a unit on it.
  await standComponent(h, "capacitor", 1, first.col - 1, first.row - 2);
  await parkUnit(h, "mote", tileCenter(first.col, first.row));
  await h.debug.clearSelection();

  const calls = await h.frameCalls();
  await captureStill(h, "numbers");

  const blits = imageDraws(calls).filter((d) => inRegion(YARD, d.cx, d.cy));
  assertGreaterThan(
    blits.length,
    0,
    "how many images the frame blitted onto the yard, which is what the " +
      "numbers have to be drawn over",
  );
  const last = Math.max(...blits.map((d) => d.index));

  const drawn = textDraws(calls).filter((d) => inRegion(YARD, d.x, d.y));
  map.waypoints.forEach((waypoint, i) => {
    const order = String(i + 1);
    const anchor = tileCenter(waypoint.col, waypoint.row);
    const found = drawn.filter(
      (d) =>
        orderOf(d.text) === i + 1 &&
        Math.hypot(d.x - anchor.x, d.y - anchor.y) <= NEAR,
    );
    if (found.length === 0) {
      fail(
        `the yard to draw the order number ${order} within ${NEAR} units of ` +
          `WP${order}'s anchor at (${waypoint.col}, ${waypoint.row}) ` +
          "(specs/pathing.md)",
        drawn.map((d) => `${d.text} @ ${Math.round(d.x)},${Math.round(d.y)}`),
      );
    }
    assertGreaterThan(
      Math.max(...found.map((d) => d.index)),
      last,
      `where WP${order}'s order number was drawn in the frame, against the ` +
        "last image the yard took",
    );
  });
});
