// cascade/trail-accumulates — the painted area grows while cards are flying.
//
// specs/victory.md: the painted layer "is never cleared while the cascade runs,
// so ... the painted area grows for as long as cards are flying, and the felt
// ends buried under overlapping cards". This point reads that growth directly:
// how much of the table is no longer bare felt after one second of a real
// cascade, and again after four.
//
// A WHOLE CASCADE, NOT A POSED CARD. The requirement is about the layer
// ACCUMULATING across many cards and many frames, so the scenario is the game's
// own ending, reached through its own win path, with the painting left on — one
// of the three points in this group that keeps it.
//
// THE CARDS IN THE AIR ARE TAKEN OUT OF BOTH READINGS, and that is what makes
// this a reading of the LAYER rather than of the cascade. A card in flight is
// drawn at its position whether or not the build kept a layer at all, and a
// cascade puts more cards in the air as it goes — six after a second, twenty-two
// after four — so a build that cleared its layer every frame would show a growing
// covered area for that reason alone. `paintedFelt` excludes the points under the
// flyers the snapshot reports, and it samples only the band of the table
// `specs/table.md` leaves empty on the `won` screen, so what is left is the layer.
//
// THE COMPARISON IS THE READING, AND NO ABSOLUTE FRACTION IS ASSERTED. The
// specification fixes no coverage figure, and it could not: how much felt is
// buried after four seconds depends on the launch velocities the cascade
// drew. What it does fix is the direction.
//
// EVERY POINT IS READ AGAINST ITSELF. The whole grid is sampled on the `won`
// screen before a single card has launched, and each later reading asks of each
// point whether IT has moved from the colour it held then. So no colour of the
// build's is assumed, and neither is a FLAT table: `specs/overview.md` leaves the
// felt to the build, and a gradient or a texture would read as paint everywhere
// at once against a single sample taken from one corner.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  type Harness,
  captureStill,
  createHarness,
  framesFor,
} from "../harness";
import { FELT_GRID, openCascade, paintedFelt, readFelt } from "./flight";

/** The two moments the review item compares, in seconds of a running cascade. */
const EARLY = 1;
const LATE = 4;

/** How many of the grid's points were painted. */
function covered(grid: readonly boolean[]): number {
  return grid.filter(Boolean).length;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("paints more of the table after four seconds than after one", async () => {
  await openCascade(harness, { painting: true });

  // The bare table, read on the `won` screen with the launching held for one
  // frame so nothing has flown and nothing has painted yet.
  await harness.debug.setLaunching(false);
  await harness.advance(1);
  const bare = await readFelt(harness);
  await harness.debug.setLaunching(true);

  await harness.advance(framesFor(EARLY));
  await captureStill(harness, "one-second");
  const early = covered(
    await paintedFelt(harness, bare, (await harness.snapshot()).flyers),
  );
  assertGreaterThan(
    early,
    0,
    `points of the felt painted after ${EARLY} s of the cascade, once the cards still in the air are taken out — a build whose layer keeps nothing reads none`,
  );

  await harness.advance(framesFor(LATE - EARLY));
  await captureStill(harness, "four-seconds");
  const late = covered(
    await paintedFelt(harness, bare, (await harness.snapshot()).flyers),
  );

  assertGreaterThan(
    late,
    early,
    `more of the ${FELT_GRID.length} sampled points of the felt to be painted after ${LATE} s of the cascade than after ${EARLY} s, and ${early} were painted at ${EARLY} s`,
  );
});
