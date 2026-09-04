// The values the engine's debug overlay shows (`specs/instrumentation.md`).
//
// Registering them is the whole of Gantry's part: drawing the panel, toggling
// it with the backtick key, and keeping it read-only are the engine's. Each
// source is handed the state current at the read and reads off that argument,
// so watching the overlay leaves the game exactly as it is.

import type { DeepReadonly, DiagnosticValue } from "@test-cabinet/simple-3d";
import { SITE_COUNT, TICK_HZ } from "./constants";
import type { GantryState } from "./game";
import { craneCost, currentSite, currentSimStructure } from "./state";
import { readiness } from "./sim";

/** One named value on the overlay. */
export interface DiagnosticSource {
  readonly name: string;
  readonly read: (state: DeepReadonly<GantryState>) => DiagnosticValue;
}

const round = (value: number, places = 2): string => value.toFixed(places);

const source = (
  name: string,
  read: (state: DeepReadonly<GantryState>) => DiagnosticValue,
): DiagnosticSource => ({ name, read });

/** The sources, in the order the panel draws them. */
export const DIAGNOSTICS: readonly DiagnosticSource[] = [
  source("screen", (s) => s.screen),
  source(
    "site",
    (s) => `${s.siteIndex + 1}/${SITE_COUNT} ${currentSite(s).name}`,
  ),
  source("members", (s) => s.sites[s.siteIndex].structure.members.length),
  source("cost", (s) => `${round(craneCost(s), 0)}/${currentSite(s).budget}`),
  source(
    "issues",
    (s) => readiness(currentSimStructure(s), currentSite(s).anchors).length,
  ),
  source("run", (s) => s.run.phase),
  source("step", (s) => s.run.stepIndex),
  source("clock", (s) => `${round(s.run.tick / TICK_HZ)}s`),
  source("cause", (s) => s.run.cause ?? "-"),
  source("slew", (s) => s.run.axes.slew.value),
  source("trolley", (s) => s.run.axes.trolley.value),
  source("hoist", (s) => s.run.axes.hoist.value),
  source("grip", (s) => s.run.axes.grip.value),
  source(
    "bob",
    (s) =>
      `${round(s.run.bob.pos.x)}, ${round(s.run.bob.pos.y)}, ${round(s.run.bob.pos.z)}`,
  ),
  source("util", (s) =>
    s.run.forces.reduce((top, f) => Math.max(top, f.utilization), 0),
  ),
  source("broken", (s) => s.run.broken.length),
  source(
    "camera",
    (s) =>
      `${round(s.camera.yaw, 1)} / ${round(s.camera.pitch, 1)} / ${round(s.camera.dist, 1)}`,
  ),
];
