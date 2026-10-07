// Orrery — the surface an ENGINELESS build installs, as types. CASE-PROVIDED.
//
// `specs/instrumentation.md` under no engine: "the build installs the finished
// surface on `window.__orrery` as soon as the game has initialized". Every call a
// check makes on it crosses into a page, so every one of them is a promise —
// which is exactly the shape `driver.ts` declares, and this project's surface
// therefore IS the driver with nothing wrapped around it.
//
// The two clock operations exist here and nowhere else. Nothing outside an
// engineless build owns its frame loop, so the specification puts the clock on
// the surface: `setAutoStep` takes the game off real time and `advance` runs whole
// frames. Both are `REQUIRED_OPS` here and in neither engine project.
//
// This file is the ONLY description of the surface this project reads. The build's
// own module for it is never imported: what a check holds a build to is the
// specification, and this is the specification.

import { STATE_OPS, type OrreryDriver } from "./driver";

/** The page global the build installs its surface on (`window.__orrery`). */
export type OrrerySurface = OrreryDriver;

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, in the order it introduces them: the two clock operations first,
 * because that is the section the specification opens with under no engine, then
 * the state operations.
 *
 * This list is what the harness's surface probe checks a build against, and the
 * order is the order a missing-operation fault names them back in.
 */
export const REQUIRED_OPS: readonly string[] = [
  "setAutoStep",
  "advance",
  ...STATE_OPS,
];
