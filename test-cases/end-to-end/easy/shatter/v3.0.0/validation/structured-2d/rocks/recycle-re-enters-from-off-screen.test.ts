// rocks/recycle-re-enters-from-off-screen — the star gives a rock back at an edge.
//
// `specs/rocks.md`, Star recycling: a rock the star swallows "is taken from the core
// and immediately re-placed at the same size. It re-enters at a random point on one
// of the four edges of the field, heading inward into the field". This item decides
// WHERE it comes back: at an edge, and not on the star's doorstep. A build that
// re-places the rock beside the core hands the player a rock that falls straight
// back in, over and over, and the field silently jams.
//
// THE RECYCLE IS FOUND AS A DISCONTINUITY, never as the rock reading far from the
// star (`scenario.ts`). A build that does not recycle at all sends its rock straight
// through the core and out the far side, where it reads exactly as far out as a
// re-placed one — so a check watching a distance would report a recycle that never
// happened and would pass that build. A jump of 200 units inside one tick, measured
// by the shortest wrapped separation, is the re-placement itself and nothing else.
//
// THE READING IS TAKEN ON THE TICK IT RE-ENTERED, swept one tick at a time, so what
// is measured is where the star put the rock rather than where a second of drift
// carried it.
//
// THE FIELD HOLDS EXACTLY ONE ROCK, so "the rock that came back" is not a guess:
// `startPlaying` clears everything and shuts the wave loop off, and `theOneRock`
// fails naming the scenario if anything else turns up. The rock is followed through
// the roster rather than by its id, because `specs/rocks.md` makes a recycled rock
// the same rock relocated but never says the id survives, and a check that demanded
// one would be demanding something the specification does not.
//
// WHAT THIS DOES NOT DECIDE. That it comes back heading INTO the field, which is
// `rocks/recycle-enters-moving-inward`'s; at a fresh drift speed, which is
// `rocks/recycle-resets-speed`'s; at the same size, which is
// `rocks/recycle-keeps-the-size`'s; and that the field's rock count is unchanged,
// which is `rocks/recycle-keeps-the-count`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  dropOntoTheStar,
  nearestEdge,
  slingIntoTheStar,
  theOneRock,
} from "./scenario";

/** How near an edge the rock must re-appear, in units, as the review item states. */
const NEAR_AN_EDGE = 100;

/** Ticks of the rock coming back in, recorded after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-places a rock the core took at one of the four edges", async () => {
  startPlaying(h);
  dropOntoTheStar(h, "large");

  // The recording runs on past the re-entry, so a reviewer watches the rock come
  // back into the field rather than the single frame the reading was taken on.
  const recycle = await captureReplay(h, "recycle", async () => {
    const taken = await slingIntoTheStar(h);
    await h.advance(AFTERMATH_TICKS);
    return taken;
  });

  const back = theOneRock(recycle.at, "the rock the star gave back");
  const edge = nearestEdge(back);

  assertLessThanOrEqual(
    edge.distance,
    NEAR_AN_EDGE,
    `units from the nearest edge (the ${edge.name}) the rock re-appeared at, ` +
      `having been taken at the core: it re-enters at a random point on one ` +
      "of the four edges of the field (specs/rocks.md)",
  );
});
