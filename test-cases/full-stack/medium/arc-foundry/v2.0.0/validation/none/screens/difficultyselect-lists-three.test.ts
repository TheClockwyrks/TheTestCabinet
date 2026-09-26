// screens/difficultyselect-lists-three — the difficulty select shows each
// difficulty's figures.
//
// THE REQUIREMENT. `specs/ui.md`, of `difficultyselect`: it "lists Easy, Medium
// and Hard, each showing its wave count and how tough its Load grows, as
// `specs/difficulty.md` states, before it is chosen." `specs/difficulty.md` says
// the same from its own side: "The difficulty select screen shows each
// difficulty's wave count and how tough its Load grows before it is chosen." The
// point of the screen is that the choice is INFORMED: a player picking Hard has
// been told it is sixty waves and that its Load climbs far past a Medium run's.
//
// HOW IT IS DECIDED. The difficulty select is opened directly, through the
// operation that reaches a screen "exactly as reaching it in play does", so a
// build with a broken map select still has this point decided on its own terms.
// The frame's own text draws are read for the three names and for the three wave
// counts, each as a number of its own so that `40` is not found inside `140`.
//
// WHAT IS DECIDED HERE AND WHAT IS NOT. "How tough its Load grows" is a phrase
// rather than a figure: `specs/difficulty.md` fixes four constants per difficulty
// and gives each a one-line character, and leaves how a build says that to the
// build. There is no wording a check could require that would be fair to every
// build that says it well, so the toughness half is left to the reviewer, who has
// the captured still in front of them. The wave count, which the specification
// does fix as a number, is decided here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTIES } from "../constants";
import { drewText } from "../case-harness/text";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewNumber } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the three difficulties and shows the waves each one runs", async () => {
  await h.debug.reset();
  await h.debug.setScreen("difficultyselect");
  const calls = await h.frameCalls();
  await captureStill(h, "difficulty");

  assertEqual(
    (await h.snapshot()).screen,
    "difficultyselect",
    "the difficulty select showing (specs/ui.md)",
  );

  for (const difficulty of DIFFICULTIES) {
    assertEqual(
      drewText(calls, difficulty.id),
      true,
      `the difficulty select to name ${difficulty.id} (specs/ui.md)`,
    );
    assertEqual(
      drewNumber(calls, difficulty.waves),
      true,
      `the difficulty select to show the ${difficulty.waves} waves ` +
        `${difficulty.id} runs (specs/ui.md, specs/difficulty.md)`,
    );
  }
});
