// presentation/foes-distinct — the three foes read apart.
//
// specs/overview.md's legibility table: "The glitch, the dropper, and the
// corruptor read apart from one another and from the board." The three do
// different things to the field — one eats it, one reseeds it, one slams it to
// critical (specs/foes.md) — so a player who cannot tell which one is crossing
// the board cannot decide which to shoot first. Both halves of the sentence are
// asserted: the three against each other, and each against the board.
//
// THE READING IS A COMPARISON, NEVER A COLOUR. specs/overview.md fixes no
// palette, so no hex value is asserted; the board is read off a bare tile in the
// foes' own row, so a build that draws its board with a gradient is read where
// the foes are.
//
// EACH FOE IS POSED WITH BOTH FACULTIES HELD. Colour is not a faculty: this point
// exercises none of a foe's behaviour, so `setFoeTravel` off holds each one on
// the tile it was posed on and `setFoeMind` off keeps it from acting on the
// field beneath it — which matters, because a dropper with its mind running lays
// a fresh node on its own tile (specs/foes.md) and the reading would then be of
// a foe standing on a node rather than of a foe on bare board.
//
// THREE TILES, EIGHT APART, ON ONE ROW well above the player band, so nothing a
// build draws around one foe reaches another and the cursor — the one body no
// scenario can pose away — is nowhere near any of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  foeOf,
  poseFoe,
  startPlaying,
  type FoeKind,
  type Harness,
} from "../harness";
import { TILE_HALF, litColor, litTile } from "./reading";

/**
 * How far two foes, and a foe and the board, must read apart, in RGB distance on
 * the 0–441 scale.
 *
 * `441` is the whole scale, `sqrt(3) * 255`. specs/overview.md requires the three
 * to "read apart from one another and from the board" and fixes no colour, so
 * the bar is what a measurement can honestly call a different colour rather than
 * a shade of the same one: 40 is under a tenth of the scale, comfortably below
 * anything legible. It is the figure every colour point in this group is set at.
 */
const APART_MIN = 40;

/** The row the three are posed on: mid-board, far from the band. */
const FOE_ROW = 8;

/** The three foes, each on its own tile, eight tiles apart. */
const FOES: readonly { kind: FoeKind; c: number }[] = [
  { kind: "glitch", c: 6 },
  { kind: "dropper", c: 14 },
  { kind: "corruptor", c: 22 },
];

/** The tile the board itself is read off: bare, in the foes' own row. */
const BARE_C = 32;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the three foes apart from one another and from the board", async () => {
  startPlaying(h);
  const posed = FOES.map((foe) => {
    const id = poseFoe(h, foe.kind, foe.c, FOE_ROW);
    h.debug.setFoeTravel(id, false);
    h.debug.setFoeMind(id, false);
    return { ...foe, id };
  });
  await h.advance(1);
  captureStill(h, "foes");

  const snapshot = h.snapshot();
  const sampled = posed.map((foe) => {
    const held = foeOf(snapshot, foe.id);
    return {
      kind: foe.kind,
      color: litColor(h, { x: held.x, y: held.y, half: TILE_HALF }),
    };
  });
  const board = litTile(h, BARE_C, FOE_ROW);

  for (let i = 0; i < sampled.length; i += 1) {
    assertGreaterThan(
      colorDistance(sampled[i].color, board),
      APART_MIN,
      `the ${sampled[i].kind} against the bare board tile (${BARE_C}, ` +
        `${FOE_ROW}) in its own row, in RGB distance out of 441 ` +
        "(specs/overview.md: the three foes read apart from the board)",
    );
    for (let j = i + 1; j < sampled.length; j += 1) {
      assertGreaterThan(
        colorDistance(sampled[i].color, sampled[j].color),
        APART_MIN,
        `the ${sampled[i].kind} against the ${sampled[j].kind}, in RGB ` +
          "distance out of 441 (specs/overview.md: the three foes read apart " +
          "from one another)",
      );
    }
  }
});
