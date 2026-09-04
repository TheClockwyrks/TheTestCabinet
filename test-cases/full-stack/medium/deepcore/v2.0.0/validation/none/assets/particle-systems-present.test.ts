// assets/particle-systems-present — every effect is a real produced system.
//
// `specs/assets.md` names twelve effects and the file each lands at, under
// `assets/fx/<name>.json`, requires each authored with `particle-2d` and played
// live, and refuses the alternative outright: "A flat opacity flash or a
// hand-coded loop in place of a produced system does not satisfy this contract."
//
// So each file is read off disk and handed to `@test-cabinet/particle-runtime` —
// the runtime `specs/assets.md` names as the one the build plays them through, and
// whose own types are the authoritative description of a system. Building a
// simulator over the parsed file is the acceptance test: a file that is not a
// system is refused, and one that is a system but declares no emitter that emits
// answers `isNonEmpty` false. Each is then stepped over its own declared duration
// and must actually produce particles, which is what separates an authored effect
// from a well-formed empty one.
//
// Nothing here reads the build. The runtime is a dependency of the project the
// build was made in, resolved exactly as the build resolves it. The still the
// review item declares is a picture of one of the systems actually playing in the
// mine, so a reviewer sees what the files turn into as well as that they parse.

import { afterEach, beforeEach, it } from "vitest";
import { ParticleSimulator } from "@test-cabinet/particle-runtime";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { assertEqual } from "../assert";
import { BAND_HEALTH, PLAYABLE_COL_MIN } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  layFloor,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { readProducedText } from "./produced";
import { FX_SYSTEMS } from "./spec";

/** Where the still is taken: a coreshell cell held under the drill. */
const ROW = 450;
const COL = PLAYABLE_COL_MIN + 8;

/** Frames the cut runs for before the picture is taken. */
const CUTTING = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The step the simulator is driven in, in milliseconds. */
const STEP_MS = 16;

/** How long a system is given to produce a particle, in milliseconds. */
const PLAY_MS = 2000;

/** A fixed seed, so a system that emits is seen to emit every time. */
const SEED = 1;

it("parses all twelve produced systems and plays each to particles", async () => {
  const faults: string[] = [];
  for (const name of FX_SYSTEMS) {
    const file = `assets/fx/${name}.json`;
    const text = readProducedText("fx", `${name}.json`);
    if (text === null) {
      faults.push(`${file}: missing`);
      continue;
    }
    let live = 0;
    try {
      const system = JSON.parse(text) as ParticleSystem;
      const simulator = new ParticleSimulator(system, { seed: SEED });
      if (!simulator.isNonEmpty) {
        faults.push(`${file}: declares no emitter that emits`);
        continue;
      }
      simulator.reset();
      const until = Math.min(PLAY_MS, Math.max(STEP_MS, system.durationMs));
      for (let at = 0; at < until && live === 0; at += STEP_MS) {
        simulator.step(STEP_MS);
        live = simulator.liveCount;
      }
    } catch (error) {
      faults.push(`${file}: ${String(error)}`);
      continue;
    }
    if (live === 0) faults.push(`${file}: produced no particle`);
  }

  // One of them, playing in the mine, as the picture the review item declares.
  await openScene(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  await h.debug.setTileHealth(COL, ROW, BAND_HEALTH.coreshell);
  await h.hold(ACTION_KEY.down);
  await h.advance(CUTTING);
  await captureStill(h, "fx");
  await h.release(ACTION_KEY.down);

  assertEqual(faults.join(", "), "", "specs/assets.md");
});
