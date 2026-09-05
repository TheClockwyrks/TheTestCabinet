// yard-drawing/waypoint-numbers-on-top — the order numbers are drawn last.
//
// `specs/pathing.md`: "each waypoint is drawn with its order number, `1` through
// `6`, and those numbers are drawn last, over the structures and the units, so
// nothing on the yard obscures the chain". `specs/hud.md` puts "the waypoint
// order numbers, drawn over everything else" among what the yard draws, and
// `specs/overview.md` makes it something a player reads at a glance.
//
// THE CROWD. A component and a unit, which are the two things `specs/pathing.md`
// names, each standing on the open yard. "Drawn last" is a fact about the ORDER
// the frame issued its operations in rather than about where the crowd stands, so
// the crowd stands well clear of every waypoint: that is what keeps a number's own
// backing — a chip, a halo, a shadow, whatever a build draws behind its digit —
// out of the reading, since such a mark is drawn where its number is and nowhere
// else.
//
// WHAT IS READ. The order the frame's operations were issued in. `order.ts` finds
// the last operation that landed inside the tiles the component and the unit
// occupy, whatever primitive the build drew them with; every one of the six
// numbers is then found near the anchor of the platform it belongs to —
// `specs/yard.md` makes that anchor "the tile the Load paths to" — and every one
// of them has to have been issued after that operation.
//
// WHICH PRIMITIVE CARRIED EACH THING IS NOT READ. A number drawn as text, a number
// blitted from an icon, and a component drawn as a sprite or as geometry all reach
// this reading the same way: what is compared is where the operations sat and the
// order they were issued in.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  inRegion,
  openYard,
  parkUnit,
  standComponent,
  textDraws,
  YARD,
} from "../harness";
import { FOOTPRINT, mapById, TILE, tileCenter } from "../constants";
import { lastOpIn, type Box } from "./order";

const MAP = "substation";
/** How far a number may sit from its platform's anchor and still be its number. */
const NEAR = 40;

/** Open ground on the Substation, clear of every waypoint platform. */
const COMPONENT = { col: 10, row: 10 };
/** Open ground the far side of the yard, clear of every waypoint platform. */
const UNIT = { x: 500, y: 400 };
/** Room around a unit's body for the health bar it carries (specs/enemies.md). */
const BODY = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws every waypoint number after the last of the yard's own drawing", async () => {
  const map = mapById(MAP);
  openYard(h, { map: MAP, wave: 30 });

  // A permanent component and a live unit, each on its own patch of open yard.
  standComponent(h, "capacitor", 1, COMPONENT.col, COMPONENT.row);
  parkUnit(h, "mote", UNIT);
  h.debug.clearSelection();

  const calls = await h.frameCalls();
  captureStill(h, "numbers");

  const crowd: Box[] = [
    {
      x: COMPONENT.col * TILE,
      y: 56 + COMPONENT.row * TILE,
      w: FOOTPRINT * TILE,
      h: FOOTPRINT * TILE,
    },
    { x: UNIT.x - BODY, y: UNIT.y - BODY, w: 2 * BODY, h: 2 * BODY },
  ];
  const last = lastOpIn(calls, crowd);
  assertGreaterThanOrEqual(
    last,
    0,
    "where the last operation drawing the component and the unit sat in the " +
      "frame, which is what the numbers have to be drawn over; the frame drew " +
      "nothing at either of them",
  );

  const drawn = textDraws(calls).filter((d) => inRegion(YARD, d.x, d.y));
  map.waypoints.forEach((waypoint, i) => {
    const order = String(i + 1);
    const anchor = tileCenter(waypoint.col, waypoint.row);
    const found = drawn.filter(
      (d) =>
        d.text.trim() === order &&
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
        "last operation that drew the component or the unit",
    );
  });
});
