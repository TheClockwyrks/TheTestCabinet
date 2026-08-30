// yard-drawing/combinable-mark — a combinable structure is marked, unselected.
//
// `specs/scrap-press.md`: "every base structure that could combine right now,
// because it has a matching partner or completes a reachable recipe, is marked on
// the yard at all times without needing to be selected", and a quality-combine is
// offered "on a base structure that has a matching partner anywhere on the yard".
// `specs/hud.md` lists that mark among the few things the yard draws over the
// map.
//
// THE ONE CHANGE. The same Capacitor at Tuned, on the same tiles, read twice:
// once alone, and once with a second Capacitor at Tuned standing eight tiles
// away. Nothing else moves — the selection is cleared in both readings, and no
// recipe in `specs/combinations.md` calls for a Capacitor at Tuned, so the mark
// that appears is the quality fold and nothing else. The partner is far enough
// that nothing drawn for IT reaches the tiles being read.
//
// WHAT IS READ, AND OVER HOW LONG. The structure's own footprint and a margin
// around it, because `specs/hud.md` says a combinable structure is marked and
// leaves the mark's shape to the build — a ring hugging the footprint is as good
// a mark as a wash inside it. And the yard is read at several moments rather than
// one, because nothing forbids the mark from pulsing, and a mark caught at the
// bottom of its breath is still a mark.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";
import { FOOTPRINT, TILE } from "../../src/constants";
import { DISTINCT, lattice, maxDistance, sample } from "./reading";

/** A type and tier no recipe of specs/combinations.md calls for. */
const TYPE = "capacitor";
const TIER = 2;
const ALONE = { col: 10, row: 10 };
const PARTNER = { col: 18, row: 10 };
/** Room around the footprint for a mark drawn as a ring rather than a wash. */
const MARGIN = 12;
/** Moments spread across two seconds, which outlasts any plausible pulse. */
const MOMENTS = 6;
const APART = 0.35;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("marks a structure once a matching partner stands, with nothing selected", async () => {
  openYard(h);

  standComponent(h, TYPE, TIER, ALONE.col, ALONE.row);
  h.debug.clearSelection();

  const over = lattice(
    {
      x: ALONE.col * TILE - MARGIN,
      y: 56 + ALONE.row * TILE - MARGIN,
      w: FOOTPRINT * TILE + 2 * MARGIN,
      h: FOOTPRINT * TILE + 2 * MARGIN,
    },
    1,
  );
  const unmarked = await sample(h, over);

  standComponent(h, TYPE, TIER, PARTNER.col, PARTNER.row);
  h.debug.clearSelection();

  let moved = 0;
  for (let i = 0; i < MOMENTS; i += 1) {
    if (i > 0) await h.advanceSeconds(APART);
    moved = Math.max(moved, maxDistance(unmarked, await sample(h, over)));
  }
  captureStill(h, "marked");

  assertGreaterThan(
    moved,
    DISTINCT,
    "how far the structure's own tiles move once a matching partner stands " +
      "elsewhere on the yard, in RGB distance, at the moment they move most",
  );
});
