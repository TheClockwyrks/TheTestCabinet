// rocks/recycle-re-enters-from-off-screen — the star puts the rock back at an edge.
//
// `specs/rocks.md`, Star recycling: a rock the star swallows "re-enters at a random
// point on one of the four edges of the field, heading inward into the field, at a
// fresh base drift speed". This item decides WHERE it comes back and nothing else:
// which way it is then pointed is `recycle-enters-moving-inward`'s item, how fast
// it is going is `recycle-resets-speed`'s, that the field still holds it is
// `recycle-keeps-the-count`'s, and what size it is is `recycle-keeps-the-size`'s.
//
// THE FIELD HOLDS ONE ROCK AND NOTHING ELSE. `startPlaying` empties every roster
// and shuts both world gates, and a Large is dropped from straight above the star's
// centre so the well's pull is exactly along its fall and it reaches the core head
// on rather than swinging past it.
//
// THE RECYCLE IS FOUND AS A JUMP, NOT AS A DISTANCE. A build that never recycles at
// all sends its rock straight through the core and out the far side, where it reads
// exactly as far from the star as a re-placed one would — so a check watching for a
// rock "far from the star" would report a recycle that never happened and pass a
// build with no recycling in it. `slingIntoTheStar` watches instead for a move of
// more than `200` units inside a single tick, measured across the seams, which
// nothing drifting can produce and only a re-placement can.
//
// THE BOUND IS THE REVIEW ITEM'S FIGURE, `100` units from the nearest of the four
// edges. The star's centre is `360` units from the nearest point of any edge
// (`specs/field.md` puts it at the centre of a `1280 x 720` field), so a build that
// left the rock sitting at the core reads `360` and a build that re-placed it at a
// random point anywhere on the field reads a typical `180` — neither can be
// mistaken for an entry.

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
} from "./scene";

/** How near an edge the rock must re-appear, in units: the review item's figure. */
const EDGE_REACH = 100;

/** Seconds of the rock heading back into the field, filmed after the reading. */
const AFTERMATH_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the rock at one of the field's four edges rather than at the core", async () => {
  startPlaying(h);
  dropOntoTheStar(h, "large");

  const recycle = await captureReplay(h, "recycle", async () => {
    const taken = await slingIntoTheStar(h);
    await h.advance(AFTERMATH_TICKS);
    return taken;
  });

  const returned = theOneRock(recycle.at, "the recycled rock");
  const edge = nearestEdge(returned);

  assertLessThanOrEqual(
    edge.distance,
    EDGE_REACH,
    `units the re-entering rock stands from ${edge.name}, the nearest of the four (specs/rocks.md)`,
  );
});
