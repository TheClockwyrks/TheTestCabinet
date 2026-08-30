// presentation/node-ramp-distinct — the four charge states are told apart.
//
// specs/overview.md's legibility table states the requirement in one line: "The
// four charge states of a node are told apart at a glance, and they read as a
// ramp". This point owns the FIRST half of that sentence — that the four states
// are four different things to look at — and presentation/node-ramp-brightens
// owns the second, that they climb.
//
// THE READING IS A COMPARISON, NEVER A COLOUR. specs/overview.md fixes no
// palette: "The palette, the type, the glow, and every other aspect of the look
// are yours." So there is no hex value on this checklist to assert, and what is
// asserted is that the four states differ FROM EACH OTHER — pairwise, all six
// pairs, so a build that told three of them apart and drew two the same is named
// for the pair it collapsed. A build that designs a beautiful ramp its own way
// passes.
//
// FOUR TILES, SPREAD, ON ONE ROW. Each node is posed on its own tile with four
// tiles of clear board between it and the next, so a glow a build draws around a
// critical node cannot reach the tile the charge-2 node stands on and lend it
// brightness it does not have. The row is well above the player band, so the
// cursor — the one body no scenario can pose away — is nowhere near any of them.
//
// The colour of a node is the colour of its lit mark, read as presentation/reading
// explains: on a dark board (specs/overview.md) a node is a sparse figure on a
// transparent field, and most of the pixels of its tile are the board showing
// through it.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX } from "../../src/constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { litTile } from "./reading";

/**
 * How far two charge states must read apart, in RGB distance on the 0–441 scale.
 *
 * `441` is the whole scale, `sqrt(3) * 255`, the distance from black to white.
 * specs/overview.md requires the four states be "told apart at a glance" and
 * fixes no colour, so the bar is what a measurement can honestly call a
 * different colour rather than a shade of the same one: 40 is under a tenth of
 * the scale — about 23 levels on each of three channels — comfortably below
 * anything legible and far above the nothing that separates two readings of one
 * colour. It is the figure every colour point in this group is set at.
 */
const APART_MIN = 40;

/** The row the ramp is posed on: mid-board, far from the band and the entry row. */
const RAMP_ROW = 8;

/** The four charge states, each on its own tile, four tiles apart. */
const RAMP = [0, 1, 2, CHARGE_MAX].map((charge, i) => ({
  charge,
  c: 12 + 4 * i,
}));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the four charge states in four colours a player tells apart", async () => {
  startPlaying(h);
  for (const node of RAMP) h.debug.setNode(node.c, RAMP_ROW, node.charge);
  await h.advance(1);
  captureStill(h, "ramp");

  const sampled = RAMP.map((node) => ({
    charge: node.charge,
    color: litTile(h, node.c, RAMP_ROW),
  }));

  for (let i = 0; i < sampled.length; i += 1) {
    for (let j = i + 1; j < sampled.length; j += 1) {
      const apart = colorDistance(sampled[i].color, sampled[j].color);
      assertGreaterThan(
        apart,
        APART_MIN,
        `the charge ${sampled[i].charge} node against the charge ` +
          `${sampled[j].charge} one, in RGB distance out of 441 ` +
          "(specs/overview.md: the four charge states are told apart at a glance)",
      );
    }
  }
});
