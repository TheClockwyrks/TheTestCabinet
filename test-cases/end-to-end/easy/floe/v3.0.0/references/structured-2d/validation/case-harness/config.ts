// The shape of a case, as the shared harness needs it.
//
// The extraction's rule is TYPES BY GENERICS, VALUES BY CONFIG: nothing about a
// particular case is baked into this package, and nothing about this package is
// baked into a case's import lines. A case constructs its kit once, from one
// object, and everything the package prints, probes, injects or writes is
// derived from it.
//
// Two things deliberately do NOT appear here, and both are load-bearing:
//
//   - The recorder and audio globals default to `__tcabRec` / `__tcabAudio`
//     rather than to a per-case name. They are the HARNESS's own instrumentation,
//     installed by `addInitScript` before a line of the build runs; no case's
//     `specs/instrumentation.md` names them, and a page only ever loads one
//     build. They stay overridable for a case that must coexist with something
//     already standing at the name, but the default is shared on purpose.
//
//   - The vitest provided-context keys are FIXED at `tcabUrl`, `tcabBrowserWs`
//     and `tcabSurfaceAbsent`, and are not configurable at all. The
//     `declare module "vitest"` block below is a GLOBAL augmentation: two cases
//     type-checked together that each declared their own key would collide, which
//     is exactly what the per-case keys were trying to avoid. One shared set
//     avoids it properly — but it only works if the key is a constant, because a
//     configurable key could not be declared here.

// A type-only import, purely so `vitest` is part of the program: a
// `declare module` augmentation of a package the file never otherwise mentions
// is rejected as "module cannot be found", and this module deliberately takes no
// runtime dependency on the test runner — it is read by the vite config too.
import type {} from "vitest";

/** Where the built site is served and which browser to attach to. */
declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from the project's `globalSetup`. */
    tcabUrl: string;
    /** The one Chromium every suite worker connects to. */
    tcabBrowserWs: string;
    /**
     * Whether this build installs no surface AT ALL, as the run settled it once
     * in `globalSetup` rather than once per harness.
     *
     * `false` is the inconclusive answer as well as the negative one, and that is
     * deliberate: a project whose `globalSetup` was given no handle to look for,
     * and a probe that could not open a page, both report `false`, which leaves
     * every harness to make its own full-ceiling reading exactly as it did before
     * the probe existed. The flag can only ever save time; it can never be the
     * thing that fails a build. See `global-setup.ts`'s `probeSurfaceAbsent` and
     * `surface.ts`'s `readSurfaceFault`.
     */
    tcabSurfaceAbsent: boolean;
  }
}

/** The provided-context key the served build's URL arrives under. */
export const PROVIDE_URL_KEY = "tcabUrl";

/** The provided-context key the shared browser's endpoint arrives under. */
export const PROVIDE_WS_KEY = "tcabBrowserWs";

/** The provided-context key the run-wide "no surface at all" answer arrives under. */
export const PROVIDE_SURFACE_ABSENT_KEY = "tcabSurfaceAbsent";

/** The page global the injected draw-command recorder installs itself on. */
export const RECORDER_GLOBAL = "__tcabRec";

/** The page global the injected audio probe installs itself on. */
export const AUDIO_GLOBAL = "__tcabAudio";

/**
 * The operations every case's `specs/instrumentation.md` requires of an
 * engineless build's debug surface, whatever else it asks for.
 *
 * This is the genuine intersection of the four cases in the repository, and it is
 * SHORTER than it looks like it should be: the step operation is NOT in it.
 * Refract, Carom and Fathom name theirs `advance`; Volute names its `step`
 * (`validation/none/constants.ts`). A shared list carrying `advance` would have
 * the surface probe report a conforming Volute build as missing an operation and
 * leave every point in that run undecided, so the step operation is the case's to
 * name and this list stops one short of it.
 *
 * A case spreads this and adds its own — the tails are disjoint, which is why the
 * name overlap between four `REQUIRED_OPS` arrays is not evidence of shared
 * content.
 */
export const BASE_REQUIRED_OPS: readonly string[] = [
  "setAutoStep",
  "reset",
  "snapshot",
];

/** The ground a replay is composited over when a frame paints no background. */
export const DEFAULT_REPLAY_BACKGROUND = "#000";

/** The specification a surface fault points the build's author at. */
export const DEFAULT_SPEC_PATH = "specs/instrumentation.md";

/**
 * How long the surface probe waits for `window.<handle>` to appear.
 *
 * A DEFAULT rather than a constant because the cases disagree, and what they
 * disagree about is how much work a build does before it can install anything.
 * Refract allows 30s; Gantry, whose build loads a produced asset set before its
 * surface goes up, allows 90s; Carom, Fathom, Volute, Wick and Orrery each state
 * this same figure in their own config. The wait is what separates "the build
 * installs no surface" from "the build was still loading", so shortening a case's
 * wait can turn a passing build into a faulted one, and a case that has chosen
 * its own figure passes it.
 *
 * FIFTEEN SECONDS IS A CEILING ON THE HOST, NOT A MEASUREMENT OF A BUILD. It ends
 * the instant the global appears, so a conformant build pays none of it however
 * high it is set — and `surface.ts` takes one look that does not wait at all
 * before it reaches for the ceiling, so on the common path a build that installed
 * its surface from its entry module never touches this number. What it bounds is
 * the cost of a build that will never answer, which is why it is set well past
 * what a loaded machine costs rather than close to what an idle one does: a build
 * failed for crossing it has been failed for the load average.
 *
 * WHO PAYS IT is `surface.ts`'s subject, not this file's: the full ceiling is
 * spent at most once per worker, and once for the whole run where a project's
 * `globalSetup` was given the handle to probe with.
 */
export const DEFAULT_SURFACE_TIMEOUT_MS = 15_000;

/** The rate a case's suite steps at when it names none. */
export const DEFAULT_TICK_HZ = 60;

/** The logical drawing surface a case's coordinates are stated in. */
export interface Stage {
  readonly width: number;
  readonly height: number;
}

/**
 * The gesture that opens the build's audio context.
 *
 * A build is free to open its audio from a real DOM event alone — both that and
 * an explicit unlock are conformant — so the gesture has to be a GENUINE browser
 * event, and the two shapes here are the two the cases actually use. Carom,
 * Fathom, Volute, Wick and Orrery each name one key their specification binds to
 * nothing and press it; Refract, whose menu bindings are the build's own and
 * whose every screen is worked from the pointer, makes a real mouse press in a
 * corner of the stage instead.
 *
 * NEITHER SHAPE HAS TO BE INERT, and Refract's cannot be: a build chooses where
 * its own controls sit, so a press in any corner is a press a build may have put
 * something under. What makes the gesture safe is when it is delivered — before
 * the harness's opening `reset`, which restores every declared field of the
 * state, so whatever the gesture moved is gone before a check reads anything.
 * It is delivered only for a harness that asked (`HarnessOptions.armAudio`), so
 * a build that is not being graded on its sound is handed no gesture at all.
 */
export type ArmGesture =
  | { readonly kind: "key"; readonly code: string }
  | { readonly kind: "click"; readonly x: number; readonly y: number };

/**
 * How the build's surface is asked to run ONE frame of the simulation.
 *
 * This is the one operation the four cases genuinely spell differently, and it is
 * why {@link BASE_REQUIRED_OPS} stops short of naming it. `specs/instrumentation.md`
 * fixes both the name and the arguments per case:
 *
 *   - `"seconds-frames"` — `op(seconds, frames)`, a run of whole frames covering
 *     a chosen span of simulated time. The suite chooses the length of a frame,
 *     so the harness's clock supplies it (Refract's and Carom's `advance`).
 *   - `"count"` — `op(count)`, a run of whole ticks of the build's own fixed
 *     length. The clock still supplies the milliseconds a recorded frame is
 *     stamped with, but the build is not told them (Fathom's `advance`, Volute's
 *     `step`).
 *
 * The distinction is not cosmetic: a `"count"` build handed a duration would run
 * hundreds of ticks for one, and a `"seconds-frames"` build handed a bare count
 * would integrate a frame of `1` second.
 */
export type StepCall =
  /** `op(seconds, frames)` — a span of simulated time, divided into frames. */
  | { readonly kind: "seconds-frames"; readonly op: string }
  /** `op(count)` — a number of whole ticks of the build's own length. */
  | { readonly kind: "count"; readonly op: string };

/**
 * Everything the shared harness needs to know about one case.
 *
 * Generic in the case's SNAPSHOT only because one member reads one: everything
 * else here is a plain value, and a case that narrows nothing may go on writing
 * the bare `CaseConfig`.
 */
export interface CaseConfig<S = unknown> {
  /** The case's slug, which prefixes every message the harness prints. */
  readonly slug: string;
  /** The page global an engineless build installs its debug surface on. */
  readonly handle: string;
  /** Every operation the case's specification requires on that surface. */
  readonly requiredOps: readonly string[];
  /**
   * Operations the surface MAY carry, which a build is not faulted for missing.
   *
   * The second list exists because a case can have VARIANTS whose specifications
   * differ in what they instrument. Spectra's overload variant declares
   * `setDroneCharge`, and a base build conforms perfectly without it — but one
   * validator project decides both, so a single `requiredOps` carrying that name
   * would have the surface probe report every conforming base build as missing
   * an operation and leave every point in the run undecided, and a list that left
   * it out would let an overload build with no `setDroneCharge` fail its overload
   * points with a raw `TypeError` from inside the page rather than with a pair a
   * reviewer can read.
   *
   * So these are probed but never required. The surface fault never mentions
   * them; instead the harness reads ONCE, per page, which of them the build
   * carries, and a call that reaches one the build does not carry fails by
   * assertion NAMING that operation. A case that declares none pays nothing — the
   * probe is skipped entirely rather than made against an empty list.
   *
   * The reading covers every route into the surface a check can take: `h.debug.x`,
   * {@link Harness.pose}, {@link Harness.sweep}'s `pose`, and the `operations` a
   * {@link Harness.trials} names. An operation in NEITHER list is not checked at
   * all, which is the honest answer — the harness was never told it should exist.
   */
  readonly optionalOps?: readonly string[];
  /** How that surface is asked to run one frame of the simulation. */
  readonly step: StepCall;
  /** The logical drawing surface the case's coordinates are stated in. */
  readonly stage: Stage;
  /**
   * The case's own validator-project directory.
   *
   * MUST come from the CASE's module (`dirname(fileURLToPath(import.meta.url))`
   * in its `harness.ts`) and never from this package's: a produced output is
   * addressed relative to it, and this package is staged one directory deeper
   * than the case's files. Getting it from here would address every replay and
   * still one level too deep, and both writers swallow their errors — the
   * outputs would simply stop appearing, with nothing failing to say so.
   */
  readonly projectRoot: string;
  /** The gesture that opens the build's audio context. */
  readonly arm: ArmGesture;
  /** The rate the suite steps at. Defaults to {@link DEFAULT_TICK_HZ}. */
  readonly tickHz?: number;
  /**
   * The seed the opening `reset` is given, when the case's specification has the
   * harness fix one.
   *
   * Omitted, the opening `reset` is called with NO argument at all, which is what
   * three of the four cases do — including one whose specification fixes a
   * default seed but whose suites pass it themselves, where a seed supplied here
   * would change the shape of the call the build sees.
   */
  readonly defaultSeed?: number;
  /**
   * Whether to read the build's state once BEFORE the opening `reset`, as the
   * harness's `openingSnapshot` and `openingScreen`.
   *
   * Off unless a case asks for it, because it is a real call into the build's
   * surface: a case that never reads it would be charged an extra `snapshot()`
   * per harness, and a build whose `snapshot` throws would fail checks that today
   * never touch it. On for the case whose specification says of its title screen
   * "The game opens here" — a fact about what a fresh game OPENS on, which the
   * opening reset would otherwise hide.
   */
  readonly readOpeningSnapshot?: boolean;
  /**
   * Whether a pixel reading waits one animation frame before it reads.
   *
   * `specs/instrumentation.md` has the step operation redraw the canvas, so on a
   * conforming build the picture is already the one the last frame left, and
   * three of the four cases read straight away. The fourth waits: a build that
   * presents on its own frame instead has drawn the same state a moment later,
   * and waiting costs a sample nothing but a frame. It is a per-case choice
   * because it changes WHEN a reading is taken, and a case's recorded readings
   * were taken one way or the other.
   */
  readonly awaitFrameBeforeRead?: boolean;
  /** The replay's ground. Defaults to {@link DEFAULT_REPLAY_BACKGROUND}. */
  readonly replayBackground?: string;
  /** The spec a surface fault cites. Defaults to {@link DEFAULT_SPEC_PATH}. */
  readonly specPath?: string;
  /** The surface probe's wait. Defaults to {@link DEFAULT_SURFACE_TIMEOUT_MS}. */
  readonly surfaceTimeoutMs?: number;
  /**
   * Whether the browser context reports a touchscreen.
   *
   * Off by default, because it is a property of the DEVICE a build believes it
   * is running on: with it on, `navigator.maxTouchPoints` is non-zero and a
   * pointer event arrives as `pointerType: "touch"`, so a build that offers
   * touch controls only on a touch device draws a different screen. A case
   * turns it on when its specification requires touch input, and a case that
   * does not stays on exactly the context it recorded its baselines against.
   */
  readonly hasTouch?: boolean;
  /**
   * Whether a frame's text calls carry a measured width and the alignment that
   * was in force at them.
   *
   * Off by default, because it costs one crossing into the page per frame read:
   * the widths are measured IN THE PAGE, against an offscreen 2D context, so a
   * run is measured under the build's own loaded fonts. A case turns it on when
   * a check reads where a run of text SITS — its extent, or the logical run a
   * letter-spaced heading spells — rather than only which strings were drawn.
   *
   * With it off, {@link DrawCall}'s `text` is absent, a text draw's extent is
   * the point its anchor names, and no two draws ever coalesce into one run.
   */
  readonly measureText?: boolean;
  /**
   * Narrow every snapshot the surface hands back to the fields the case's own
   * specification fixes.
   *
   * A specification declares what a snapshot REPORTS, and a build is commonly
   * free to carry more — a beam's cell that also names its node's kind is
   * derived data the case's own state contract grants. A check that compares
   * snapshots structurally would charge that reporting choice at every call
   * site, so a case that has such a field hands the narrowing in here and every
   * comparison is made on the fields the specification fixes.
   *
   * Applied at every point a snapshot crosses back out of the page — the
   * `snapshot` operation itself, however it is reached, and the states a driven
   * run reads — so no check can hold an unprojected one. The object the page
   * returned is never mutated: a projection returns fresh containers.
   *
   * Declared as a METHOD so a case may hand in one typed over its own snapshot.
   */
  projectSnapshot?(snapshot: S): S;
  /**
   * Init scripts to inject BEFORE the package's own, resolved against
   * {@link projectRoot}.
   *
   * The order is the whole of the difference between this and
   * {@link extraInitScripts}, and it is load-bearing rather than cosmetic. The
   * package's `recorder-init.js` REPLACES `HTMLCanvasElement.prototype.getContext`
   * with one that hands back a recording proxy, so a case script that needs the
   * page's real `getContext` — spectra's `raster-init.js` takes it for the probe
   * it measures a fill's opacity on — has to run first or it measures through the
   * proxy, or installs nothing at all. Run in the other order the script is not
   * broken loudly; it is broken quietly, and what it costs is a filtered build's
   * `captureStill` going from 269 ms to 15.5 s and the check being cut short.
   *
   * A script that only wants to be there before the BUILD is — which is what
   * every case using {@link extraInitScripts} today wants — belongs in that list
   * instead: both run before a line of the build's own script, and only this one
   * also runs before the harness's instrumentation, which is the more fragile
   * position to stand in.
   */
  readonly preInitScripts?: readonly string[];
  /** Further init scripts to inject, resolved against {@link projectRoot}. */
  readonly extraInitScripts?: readonly string[];
  /** The recorder's page global. Defaults to {@link RECORDER_GLOBAL}. */
  readonly recorderGlobal?: string;
  /** The audio probe's page global. Defaults to {@link AUDIO_GLOBAL}. */
  readonly audioGlobal?: string;
}

/** A {@link CaseConfig} with every default filled in. */
export interface ResolvedConfig {
  readonly slug: string;
  readonly handle: string;
  readonly requiredOps: readonly string[];
  readonly optionalOps: readonly string[];
  readonly step: StepCall;
  readonly stage: Stage;
  readonly projectRoot: string;
  readonly arm: ArmGesture;
  readonly tickHz: number;
  readonly defaultSeed: number | null;
  readonly readOpeningSnapshot: boolean;
  readonly awaitFrameBeforeRead: boolean;
  readonly replayBackground: string;
  readonly specPath: string;
  readonly surfaceTimeoutMs: number;
  readonly hasTouch: boolean;
  readonly measureText: boolean;
  readonly preInitScripts: readonly string[];
  readonly extraInitScripts: readonly string[];
  readonly recorderGlobal: string;
  readonly audioGlobal: string;
}

/** Fill in every default a case left out. */
export function resolveConfig(config: CaseConfig): ResolvedConfig {
  return {
    slug: config.slug,
    handle: config.handle,
    requiredOps: config.requiredOps,
    optionalOps: config.optionalOps ?? [],
    step: config.step,
    stage: config.stage,
    projectRoot: config.projectRoot,
    arm: config.arm,
    tickHz: config.tickHz ?? DEFAULT_TICK_HZ,
    defaultSeed: config.defaultSeed ?? null,
    readOpeningSnapshot: config.readOpeningSnapshot ?? false,
    awaitFrameBeforeRead: config.awaitFrameBeforeRead ?? false,
    replayBackground: config.replayBackground ?? DEFAULT_REPLAY_BACKGROUND,
    specPath: config.specPath ?? DEFAULT_SPEC_PATH,
    surfaceTimeoutMs: config.surfaceTimeoutMs ?? DEFAULT_SURFACE_TIMEOUT_MS,
    hasTouch: config.hasTouch ?? false,
    measureText: config.measureText ?? false,
    preInitScripts: config.preInitScripts ?? [],
    extraInitScripts: config.extraInitScripts ?? [],
    recorderGlobal: config.recorderGlobal ?? RECORDER_GLOBAL,
    audioGlobal: config.audioGlobal ?? AUDIO_GLOBAL,
  };
}
