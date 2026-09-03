// director/swarm-heading — every gnat of a swarm heads back along `-d`.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): "Every
// gnat in the swarm spawns with heading `-d`, so the whole line drifts across
// the lamplighter's position and on past it." The heading is what carries it,
// because the gnat's behavior is `drift` ("| Gnat | `gnat` | 2 | 160 | 3 | 8 |
// small | drift |"), and a drifter "keeps the heading it spawned with for its
// whole life and advances one step along it every tick ... The lamplighter's
// later movement changes nothing about it". The life of an enemy names the
// exception that makes the swarm's heading the swarm's: an enemy takes "the
// unit vector from its spawn point to the lamplighter's center ... except for a
// swarm gnat, which takes the swarm's heading".
//
// WHAT THE READING SEPARATES. `-d` is not the same as "toward the lamplighter"
// for any gnat but the one at the line's middle: a gnat 360 units along the
// line points at the lamplighter along a direction some 25 degrees off `-d`. So
// a build that gave each swarm gnat the ordinary spawn heading fails here on
// twenty-two of the twenty-four, while a build that gave the whole line one
// heading passes. That is also what makes the line stay a line as it drifts.
//
// HOW `d` IS RECOVERED. `director/swarms.ts` states it: the mean of the
// twenty-four positions is the line's center, and `d` is the unit vector to it.
// No angle is assumed, because the angle is drawn from the seeded generator.
//
// WHY THE DRIFT IS FILMED. The heading is read on the spawn tick, before
// anything has moved. The ticks after it are run with `enemyMotion` on for the
// replay alone, so a reviewer watching the evidence sees the line cross the
// lamplighter rather than a still of twenty-four gnats.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone while
// the swarm is read, so the window timer's spawns cannot be mistaken for the
// swarm's, and `enemyContact` and `despawning` stay off through the drift, so
// no gnat is removed or lands a hit as the line passes.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` allowed a figure carried through
// `cos` and `sin`, on the components of a unit vector. The two headings a build
// might have chosen differ by up to 0.45 in a component, five orders past it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import { captureReplay, createHarness, enable, type Harness } from "../harness";
import { poseSwarm, type Swarm } from "./swarms";

/** Ticks of drift filmed after the swarm has been read: two seconds of game time. */
const DRIFT_TICKS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives all 24 gnats the heading -d, and the line drifts across", async () => {
  const swarm = await captureReplay(h, "heading", async (): Promise<Swarm> => {
    const spawned = await poseSwarm(h);
    await enable(h, "enemyMotion");
    await h.step(DRIFT_TICKS);
    return spawned;
  });

  for (const gnat of swarm.gnats) {
    assertNear(
      gnat.heading.x,
      -swarm.direction.x,
      POSITION_TOL,
      `the x of gnat ${gnat.id}'s heading against the swarm's -d`,
    );
    assertNear(
      gnat.heading.y,
      -swarm.direction.y,
      POSITION_TOL,
      `the y of gnat ${gnat.id}'s heading against the swarm's -d`,
    );
  }
});
