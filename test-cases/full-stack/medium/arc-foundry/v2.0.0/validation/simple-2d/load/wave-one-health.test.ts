// load/wave-one-health — at wave 1 health is round(baseHP * baseMult).
//
// specs/enemies.md gives a unit's maximum health on wave `w` as
// `round( baseHP * baseMult * [ (1 + k * (w - 1)) + c * (r^(w - 1) - 1) ] )` and
// then fixes the opening of that formula exactly: "The surcharge is exactly `0`
// at wave `1`", and "At wave `1` the formula yields `round(baseHP * baseMult)`.
// On Medium, whose `baseMult` is `0.22`, a Mote's `44 * 0.22 = 9.68` is `10`
// health and a Filament's `74 * 0.22 = 16.28` is `16`."
//
// So wave `1` is read on its own, against the product alone rather than against
// the whole formula: at `w = 1` both bracketed terms vanish, `(1 + k * 0)` being
// `1` and `c * (r^0 - 1)` being `0`, and a build that leaves a surcharge in at
// wave `1` reads high here while still tracking the formula everywhere else.
// Every one of the six roster types is read, because `baseMult` multiplies each
// of six different base figures and only some of them round the same way.
//
// The units are released frozen onto an empty yard, so nothing removes health
// between the release and the reading, and `maxHp` is what is read rather than
// `hp`: it is the figure the scaling sets and the one the health bar reads a
// fraction of.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { difficultyById, LOAD_ROSTER } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  releaseUnit,
  unitById,
} from "../harness";

/** The difficulty the specification works the example through. */
const DIFFICULTY = "medium";
const BASE_MULT = difficultyById(DIFFICULTY).baseMult;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens every roster type at round(baseHP * baseMult)", async () => {
  openYard(h, { difficulty: DIFFICULTY, wave: 1 });

  const released = new Map<string, number>();
  for (const def of LOAD_ROSTER) {
    released.set(def.type, releaseUnit(h, def.type, { frozen: true }));
  }

  await h.advance(1);
  captureStill(h, "wave1");

  const s = h.snapshot();
  for (const def of LOAD_ROSTER) {
    assertEqual(
      unitById(s, released.get(def.type)!).maxHp,
      Math.round(def.baseHealth * BASE_MULT),
      `a wave-1 ${def.type}: round(${def.baseHealth} * ${BASE_MULT})`,
    );
  }
});
