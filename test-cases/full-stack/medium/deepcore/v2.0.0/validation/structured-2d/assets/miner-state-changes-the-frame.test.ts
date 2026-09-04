// assets/miner-state-changes-the-frame — each state draws its own miner.
//
// `specs/assets.md` asks for one produced cycle per animation state and describes
// what each carries: standing at rest, a readable walk, braced downward, thrusting,
// dropping limp. `specs/overview.md` states the requirement those descriptions
// serve: "The miner ... the same character in every animation state, and its
// current state is readable from the frame on screen."
//
// So the miner is driven into five of its states in turn — the five ordinary play
// moves through — and the pixels over its BOX are read in each. Every pair has to
// be drawn differently: a build playing one cycle for everything draws the same
// picture five times and fails, whatever it shipped under `assets/miner/`.
//
// THE BOX, NOT THE SPRITE'S FOOTPRINT. `specs/character.md` fixes the box at
// `MINER_W` by `MINER_H` and puts the miner's feet at its bottom edge, so the box
// holds the miner and nothing of the floor beneath it. That is what keeps the
// comparison about the miner: a reading that took in the ground would separate a
// standing miner from a falling one on the ground alone.
//
// Each state is reached by doing the thing rather than by posing a state, and the
// snapshot's own `state` is asserted for each reading, so a build whose state
// machine is wrong fails its own points rather than quietly passing this one.

import { afterEach, beforeEach, it } from "vitest";
import type { MinerState } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { boxChanged, sampleBox } from "./drawn";
import { minerBox, showMiner } from "./miner";

/** The five states ordinary play moves through, in the order they are driven. */
const STATES: readonly MinerState[] = [
  "idle",
  "walk",
  "drill-down",
  "jetpack",
  "fall",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("draws a different miner in each of five states", async () => {
  const seen: { state: MinerState; drawn: MinerState; pixels: number[] }[] = [];
  for (const state of STATES) {
    await showMiner(h, state);
    seen.push({
      state,
      drawn: h.snapshot().miner.state,
      pixels: sampleBox(h, minerBox(h)),
    });
    // The picture the review item declares: two of the five, one against the
    // other, taken where the drill's own state is on screen.
    if (state === "drill-down") captureStill(h, "states");
  }

  const same: string[] = [];
  for (const [at, one] of seen.entries()) {
    for (const other of seen.slice(at + 1)) {
      if (boxChanged(one.pixels, other.pixels) === 0) {
        same.push(`${one.state}/${other.state}`);
      }
    }
  }

  assertEqual(
    seen.map((entry) => entry.drawn).join(", "),
    STATES.join(", "),
    "specs/character.md",
  );
  assertEqual(same.join(", "), "", "specs/assets.md");
});
