// rocks/recycle-keeps-the-size — the star gives back the rock it took.
//
// `specs/rocks.md`, Star recycling: "A rock the star swallows is the same rock
// relocated, not a fresh one", and it "is taken from the core and immediately
// re-placed AT THE SAME SIZE". This item decides the size alone. A build that
// re-places every recycled rock as a Large turns the star into a spawner and the
// player's work on the split ladder is undone every time a Small falls in; a build
// that steps the size down treats the core as a kill and quietly scores the player
// nothing for it.
//
// ALL THREE SIZES ARE READ, in three worlds of their own, because the wrong models
// are size-dependent: a build that always returns a Large passes a Large's pass and
// fails the other two, and a build that steps the ladder down passes nothing but
// keeps a Small alive as a Small only if it stops there. Reading one size would
// grade a third of the rule, and a failure names which size came back wrong.
//
// EACH PASS IS ITS OWN ISOLATED FIELD. `startPlaying` clears everything between
// them, so the rock read after a recycle is the one that went in and not a leftover
// of the pass before, and `theOneRock` fails naming the scenario if anything else is
// on the field.
//
// THE RECYCLE IS FOUND AS A DISCONTINUITY (`scenario.ts`) rather than as the rock
// reading far from the star, so a build that sends its rock straight through the
// core fails the drive instead of passing this on a rock that was never taken. And
// the rock is found in the roster rather than by its id, because `specs/rocks.md`
// never says the id survives the trip.
//
// WHAT THIS DOES NOT DECIDE. That the count is unchanged, which is
// `rocks/recycle-keeps-the-count`'s; where and how fast it came back, which are
// `rocks/recycle-re-enters-from-off-screen` and `rocks/recycle-resets-speed`; and,
// under `warhead`, that it comes back carrying the damage it had, which is
// `armor/recycling-preserves-health`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  dropOntoTheStar,
  slingIntoTheStar,
  theOneRock,
  type Recycle,
} from "./scenario";
import type { RockSize } from "../harness";

/** The three sizes specs/rocks.md gives a rock, each slung through the star. */
const SIZES: readonly RockSize[] = ["large", "medium", "small"];

/** Ticks of the last recycled rock coming in, run after the readings are taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a rock of each size at the size it went into the core", async () => {
  const passes: [RockSize, Recycle][] = [];
  for (const size of SIZES) {
    startPlaying(h);
    dropOntoTheStar(h, size);
    passes.push([size, await slingIntoTheStar(h)]);
  }

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "recycle");

  for (const [size, recycle] of passes) {
    const taken = theOneRock(
      recycle.before,
      `the ${size} on its way into the core`,
    );
    const back = theOneRock(
      recycle.at,
      `the rock the star gave back for a ${size}`,
    );
    assertEqual(
      taken.size,
      size,
      `the size the rock carried into the core, having been posed as a ${size} ` +
        "(specs/instrumentation.md)",
    );
    assertEqual(
      back.size,
      size,
      `the size the rock came back at, having gone in as a ${size} — a ` +
        "recycled rock is the same rock relocated, re-placed at the same size " +
        "(specs/rocks.md)",
    );
  }
});
