// discharge/arcs-reported — the discharge reports one arc per conducted link.
//
// specs/discharge.md, The arcs: "A discharge reports one arc for each link the
// chain conducted along: the ordered pair of tiles joined by one node detonating
// another. A chain that detonates `n` nodes therefore reports `n - 1` arcs", and
// "Every arc of a discharge is created at the moment the chain resolves and lasts
// `ARC_LIFE` (`0.32` s) of game time, after which it is gone. No arc is reported
// at any other time."
//
// The board makes the link set unambiguous, which is what lets a count be asserted
// at all. Four nodes stand two columns apart along one row: each is within
// `DISCHARGE_RADIUS` (`2`) of its neighbor and four or more from everything else,
// so the only pairs the chain can conduct between are the three consecutive ones.
//
// HOW FAR THE CHAIN GOT IS READ, NOT ASSUMED. `n` is counted off the board — the
// nodes that were posed, less the nodes still standing — so this point holds a
// build to reporting one arc per link it actually conducted along rather than to
// chaining the whole line. A build whose chain stops early fails the chain points
// next door, which own that rule, and is graded here on the arcs it owed for the
// links it did conduct.
//
// The second reading is the same window, later. It waits out `ARC_LIFE` from the
// detonation and reads the list again, where a build that leaves its arcs standing
// — or that reports the links as permanent state rather than as a fading effect —
// still has entries.
//
// What is read is the LINK SET, never the drawn polyline: the lightning's shape is
// appearance, and presentation.arcs-drawn is the only point that touches it.

import { afterEach, beforeEach, it } from "vitest";
import { ARC_LIFE } from "../constants";
import { assertLength, assertNull, assertTrue } from "../assert";
import {
  arcJoins,
  captureStill,
  chargeAt,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
  type Tile,
} from "../harness";
import { detonate, FLIGHT_TICKS } from "./detonation";

/** The critical node at the near end of the line. */
const STRUCK: Tile = { c: 8, r: 8 };

/**
 * The charged nodes beyond it, each two columns past the one before, so the only
 * pairs within `DISCHARGE_RADIUS` (`2`) of each other are consecutive ones.
 */
const LINE: Tile[] = [
  { c: 10, r: 8 },
  { c: 12, r: 8 },
  { c: 14, r: 8 },
];

/** The charge each is posed at: the lowest the chain conducts to. */
const LINE_CHARGE = 1;

/** Every node the board holds, from the struck one outward. */
const POSED: Tile[] = [STRUCK, ...LINE];

/** The links the chain can conduct along, in the order it would walk them. */
const LINKS: [Tile, Tile][] = [
  [POSED[0], POSED[1]],
  [POSED[1], POSED[2]],
  [POSED[2], POSED[3]],
];

/**
 * Frames waited before the arcs must be gone.
 *
 * `ARC_LIFE` runs from the moment the chain resolved, which fell somewhere inside
 * the shot's flight window, so the wait covers that whole window as well as the
 * life itself. One further frame is slack, so a build whose arc expires exactly at
 * `ARC_LIFE` is read on the frame that crosses the figure rather than the frame
 * that reaches it.
 */
const EXPIRY_TICKS = FLIGHT_TICKS + ticksFor(ARC_LIFE) + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports one arc per conducted link, and none once ARC_LIFE has passed", async () => {
  startPlaying(h);
  for (const node of LINE) h.debug.setNode(node.c, node.r, LINE_CHARGE);

  await detonate(h, STRUCK.c, STRUCK.r);

  captureStill(h, "arcs");
  const live = h.snapshot();
  assertNull(
    chargeAt(live, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );

  // Every posed node that is gone was detonated by the chain, and a chain that
  // detonates `n` nodes conducted along `n - 1` links.
  const gone = (tile: Tile): boolean => chargeAt(live, tile.c, tile.r) === null;
  const detonated = POSED.filter(gone).length;
  assertLength(
    live.arcs,
    detonated - 1,
    `the arcs reported for a chain that detonated ${detonated} nodes`,
  );

  for (const [from, to] of LINKS) {
    if (!gone(from) || !gone(to)) continue;
    assertTrue(
      arcJoins(live, from, to),
      `an arc joining (${from.c}, ${from.r}) and (${to.c}, ${to.r}), ` +
        `the link the chain conducted along between them`,
    );
  }

  await h.advance(EXPIRY_TICKS);
  assertLength(h.snapshot().arcs, 0, "the arcs still reported after ARC_LIFE");
});
