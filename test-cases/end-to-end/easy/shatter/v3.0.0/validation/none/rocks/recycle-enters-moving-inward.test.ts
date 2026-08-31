// rocks/recycle-enters-moving-inward — the returned rock is pointed into the field.
//
// `specs/rocks.md`, Star recycling: the rock "re-enters at a random point on one of
// the four edges of the field, heading inward into the field". This item decides
// the heading alone — that the velocity it comes back with carries it away from the
// edge it entered at — and nothing else: where it came back is
// `recycle-re-enters-from-off-screen`'s item and how fast it is going is
// `recycle-resets-speed`'s.
//
// WHY IT MUST BE READ AGAINST THE EDGE THE ROCK ACTUALLY CAME BACK AT. The entry
// point is a random draw over all four edges (`specs/rocks.md`), so there is no
// fixed direction "inward" means. The check finds the nearest of the four edges to
// the re-entry point and reads the velocity's component along that edge's own
// inward normal, which is positive for every conforming entry and negative for one
// that would carry the rock straight back out.
//
// THE FIELD HOLDS ONE ROCK AND NOTHING ELSE. `startPlaying` empties every roster
// and shuts both world gates, and a Large is dropped from straight above the star's
// centre, so the well's pull is exactly along its fall and it reaches the core head
// on. The recycle itself is found as a move of more than `200` units inside one
// tick, which nothing drifting can produce, so a build with no recycling in it fails
// rather than being read as one.
//
// THE READING IS TAKEN ON THE TICK OF THE RE-ENTRY, before the well has had time to
// turn the fresh velocity: at the nearest an edge comes to the star (`360` units,
// `specs/field.md`) the pull is `34.7` units per second squared, a third of a unit
// over a tick, against an entry speed of at least `60` (`specs/rocks.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { componentAlong } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  velocityOf,
  type Harness,
} from "../harness";
import {
  FALL_FROM,
  FALL_SPEED,
  nearestEdge,
  poseRockAt,
  slingIntoTheStar,
  theOneRock,
} from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives the re-entering rock a velocity that carries it into the field", async () => {
  await startPlaying(h);
  await poseRockAt(h, "large", FALL_FROM, { x: 0, y: FALL_SPEED });

  const recycle = await slingIntoTheStar(h);
  await captureStill(h, "recycle");

  const returned = theOneRock(recycle.at, "the recycled rock");
  const edge = nearestEdge(returned);

  assertGreaterThan(
    componentAlong(velocityOf(returned), edge.inward),
    0,
    `units per second the re-entering rock is travelling away from ${edge.name} it came back at (specs/rocks.md)`,
  );
});
