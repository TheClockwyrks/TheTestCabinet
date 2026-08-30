// One case, one call: everything a case's `harness.ts` needs, bound to it.
//
// TYPES BY GENERICS, VALUES BY CONFIG. A case says what its snapshot and its
// debug surface are as type arguments, and everything else about itself in one
// object; what comes back is the package's machinery with the case's own names
// and the case's own types on it. Its suites go on importing `createHarness`,
// `captureReplay`, `watchCues` and the tick arithmetic from `../harness` exactly
// as they did, and none of them can tell the difference:
//
// ```ts
// // validation/none/harness.ts
// const kit = createCaseHarness<RefractSnapshot, RefractDebugApi>({
//   slug: "refract",
//   handle: HANDLE,
//   requiredOps: REQUIRED_OPS,
//   step: { kind: "seconds-frames", op: "advance" },
//   stage: { width: STAGE_W, height: STAGE_H },
//   arm: { kind: "click", x: 2, y: 2 },
//   tickHz: 60,
//   projectRoot: dirname(fileURLToPath(import.meta.url)),
// });
// export const {
//   createHarness, captureReplay, captureStill, watchCues,
//   fitViewport, failSurface, SURFACE_REQUIREMENT, seconds,
// } = kit;
// export type Harness = BaseHarness<RefractSnapshot, RefractDebugApi>;
// ```
//
// WHY THE KIT AND NOT THE FREE FUNCTIONS. Three of these need a value the case
// alone knows and the suite must not have to repeat at every call: the stage a
// viewport is fitted to, the requirement a surface fault is paired with, and the
// rate a second of simulated time is counted at. Binding them once here is what
// makes `h.advance` and `seconds(n)` agree about what a frame is — the mismatch
// the package refuses to make representable by exporting no bare `TICK_HZ` of its
// own.

import {
  captureReplay,
  captureStill,
  createHarnessFactory,
  watchCues,
  type Harness,
  type HarnessOptions,
  type TimedCue,
} from "./harness";
import { makeTickMath, type TickMath } from "./clock";
import { resolveConfig, type CaseConfig, type ResolvedConfig } from "./config";
import { makeFailSurface, surfaceRequirement } from "./surface";
import { fitViewport, type Viewport } from "./viewport";

/**
 * The package's machinery, bound to one case.
 *
 * Every member is declared as a METHOD rather than as a property holding a
 * function, for the same reason {@link Harness}'s are: method parameters are
 * bivariant, so a case can hand a member of its kit to a helper typed over a
 * looser harness.
 */
export interface CaseHarnessKit<S, D> extends TickMath {
  /** The case this kit was built for, with every default filled in. */
  readonly config: ResolvedConfig;
  /** Open a page on the build and take the game off its own clock. */
  createHarness(options?: HarnessOptions): Promise<Harness<S, D>>;
  /** Record the frames `scenario` drives as the review item's `outputId`. */
  captureReplay<T>(
    h: Harness<S, D>,
    outputId: string,
    scenario: () => T | Promise<T>,
  ): Promise<T>;
  /** Keep the picture on the canvas as the review item's `outputId`. */
  captureStill(h: Harness<S, D>, outputId: string): Promise<void>;
  /** Collect every sound the build emits from now on, stamped with its frame. */
  watchCues(h: Harness<S, D>): TimedCue[];
  /**
   * How the case's stage maps onto a surface of this shape.
   *
   * The stage is the case's and arrives from its config, so a check states only
   * the window it is asking about.
   */
  fitViewport(cssWidth: number, cssHeight: number, dpr?: number): Viewport;
  /** Fail the running check on a surface fault, beside what the spec requires. */
  failSurface(fault: string): never;
  /** What the specification requires of the surface, as a failure's `Expected:`. */
  readonly SURFACE_REQUIREMENT: string;
}

/** Bind the shared harness to one case, once. */
export function createCaseHarness<S, D extends object>(
  config: CaseConfig<S>,
): CaseHarnessKit<S, D> {
  const resolved = resolveConfig(config);
  const requirement = surfaceRequirement(resolved.handle, resolved.specPath);
  return {
    config: resolved,
    createHarness: createHarnessFactory<S, D>(config),
    captureReplay,
    captureStill,
    watchCues,
    fitViewport: (cssWidth, cssHeight, dpr = 1) =>
      fitViewport(cssWidth, cssHeight, dpr, resolved.stage),
    failSurface: makeFailSurface(requirement),
    SURFACE_REQUIREMENT: requirement,
    ...makeTickMath(resolved.tickHz),
  };
}
