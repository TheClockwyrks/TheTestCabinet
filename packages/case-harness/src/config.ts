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
//   - The vitest provided-context keys are FIXED at `tcabUrl` / `tcabBrowserWs`
//     and are not configurable at all. The `declare module "vitest"` block below
//     is a GLOBAL augmentation: two cases type-checked together that each
//     declared their own key would collide, which is exactly what the per-case
//     keys were trying to avoid. One shared pair avoids it properly — but it only
//     works if the key is a constant, because a configurable key could not be
//     declared here.

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
  }
}

/** The provided-context key the served build's URL arrives under. */
export const PROVIDE_URL_KEY = "tcabUrl";

/** The provided-context key the shared browser's endpoint arrives under. */
export const PROVIDE_WS_KEY = "tcabBrowserWs";

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
 * A default rather than a constant because the four cases disagree — Refract and
 * Carom allow 5s, Fathom and Volute 15s — and the wait is what separates "the
 * build installs no surface" from "the build was still loading". Shortening a
 * case's wait can turn a passing build into a faulted one, so a case that has
 * chosen its own figure passes it.
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
 * Fathom and Volute each fix one key their bindings leave inert and press it;
 * Refract fixes no such key (its menu bindings are the build's own) and instead
 * makes a real mouse press in a corner of the stage that hits nothing.
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

/** Everything the shared harness needs to know about one case. */
export interface CaseConfig {
  /** The case's slug, which prefixes every message the harness prints. */
  readonly slug: string;
  /** The page global an engineless build installs its debug surface on. */
  readonly handle: string;
  /** Every operation the case's specification requires on that surface. */
  readonly requiredOps: readonly string[];
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
    extraInitScripts: config.extraInitScripts ?? [],
    recorderGlobal: config.recorderGlobal ?? RECORDER_GLOBAL,
    audioGlobal: config.audioGlobal ?? AUDIO_GLOBAL,
  };
}
