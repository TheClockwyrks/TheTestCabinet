// rocks/recycle-enters-moving-inward — a recycled rock heads into the field.
//
// `specs/rocks.md`, Star recycling: the rock "re-enters at a random point on one of
// the four edges of the field, HEADING INWARD INTO THE FIELD, at a fresh base drift
// speed". This item decides that clause on its own: whatever edge the star drew and
// whatever speed it gave the rock, the velocity it comes back with carries it away
// from that edge. A build that re-places the rock correctly and then draws its
// direction at random hands half its recycled rocks straight back out of the field,
// where they wrap and re-enter somewhere else entirely.
//
// THE EDGE IS THE ONE THE ROCK CAME BACK AT, not one the check chose: an edge whose
// seam it is standing on, with the inward normal that edge fixes. The reading is
// then the component of the rock's velocity along that normal, and the requirement
// is that it is positive — the rock is going in, not out and not sliding along.
//
// AND THE POSITION ALONE CANNOT NAME THAT EDGE. The field is a torus and its four
// edges are two seams (`specs/field.md`, "The wrap"), so a rock re-placed on the
// right edge reports `x = 0` — the wrap having brought `FIELD_W` back into range —
// and stands on the left edge and the right edge at once. `entryEdge` therefore
// takes every edge the rock stands within a hundred units of and reads the one it
// is actually heading away from. It names no edge the rock is not standing on: a
// rock left in the middle of the field matches none of the four and fails saying so,
// and a rock sliding ALONG a seam carries no inward component at all and fails on
// the reading itself.
//
// FOUR RECYCLES ARE READ, NOT ONE. `specs/rocks.md` draws the edge with probability
// a quarter each, so a single pass grades one edge and a build that is right about
// the left edge and wrong about the top passes it three times in four. Nothing is
// posed for the edge: `setNextRecycleEdge` is how a check that wants a particular
// one gets it, and this check wants the build's own draws.
// Each pass is a real trip through the core: the rock is aimed back at the star and
// followed in again, so the draws are the ones the build would make in play.
//
// THE READING IS TAKEN ON THE TICK IT RE-ENTERED, swept one tick at a time, so it is
// the velocity the star gave the rock rather than one the well has bent.
//
// WHAT THIS DOES NOT DECIDE. Where it came back, which is
// `rocks/recycle-re-enters-from-off-screen`'s; how fast, which is
// `rocks/recycle-resets-speed`'s and the two `rocks/drift-speed-*` entry items';
// and at what size, which is `rocks/recycle-keeps-the-size`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  distanceFromAnyEdge,
  dropOntoTheStar,
  entryEdge,
  slingAgain,
  slingIntoTheStar,
  theOneRock,
  type Recycle,
} from "./scenario";

/** How many trips through the core are read, so more than one edge is graded. */
const PASSES = 4;

/** How far from a seam the rock may stand and still be read as standing on it. */
const EDGE_REACH = 100;

/** Ticks of the last recycled rock coming in, run after the readings are taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every recycled rock a velocity that carries it off its edge", async () => {
  startPlaying(h);
  dropOntoTheStar(h, "medium");

  const entries: Recycle[] = [];
  for (let pass = 1; pass <= PASSES; pass += 1) {
    entries.push(pass === 1 ? await slingIntoTheStar(h) : await slingAgain(h));
  }

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "recycle");

  for (const [index, recycle] of entries.entries()) {
    const back = theOneRock(
      recycle.at,
      `pass ${index + 1}: the rock the star gave back`,
    );
    const edge = entryEdge(back, EDGE_REACH);
    if (edge === null) {
      fail(
        `pass ${index + 1}: the rock the star gave back standing on one of the ` +
          "field's four edges, to read its heading against (specs/rocks.md)",
        `it came back ${distanceFromAnyEdge(back).toFixed(1)} units from the ` +
          "nearest of them",
      );
    }
    assertGreaterThan(
      back.vx * edge.inward.x + back.vy * edge.inward.y,
      0,
      `pass ${index + 1}: units per second of the re-entering rock's velocity ` +
        `pointing INTO the field from the ${edge.name} edge it came back at — ` +
        "a recycled rock re-enters heading inward (specs/rocks.md)",
    );
  }
});
