// The harness: one page, one build, and everything a check reads off it.
//
// Every check in an engineless suite is an ordinary vitest test that drives the
// built site IN A REAL BROWSER. There is nothing to import: an engineless run
// seeds no `src/` at all, so the build wrote its own frame loop, its own canvas
// fit, its own keyboard and pointer, its own audio, and its own debug surface —
// and the only place all of that exists is a page that has loaded the bundle. So
// the project serves the build output, loads it in Chromium, and reaches the game
// the way anything reaches it: over the surface the specification told the build
// to install.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and the step operation runs whole frames. Every
// harness opens by taking the game off the clock, so a check asks for a number of
// frames and gets exactly that number.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than reading the state in process.
//
// ONE INTERFACE, FOUR VOCABULARIES. The four cases this was extracted from name
// the same machinery differently — `frame()` and `tick()`, `advance()` and
// `step()` and `skip()`, `until()` and `stepUntil()` and `skipUntil()`,
// `maxFrames` and `maxTicks`, `frames` and `ticks`. Those are not four designs;
// they are one design under four house styles, and a suite is written in its
// case's. So {@link Harness} is the UNION of all of them: each aliased pair is
// implemented ONCE and exposed under both names, {@link UntilOptions} accepts
// either spelling of its bound, and {@link UntilResult} carries both spellings of
// its count. Nothing is dropped to keep the union small — a member a case never
// calls costs it nothing, and every name dropped would be a suite rewritten.
//
// METHOD SYNTAX IS LOAD-BEARING. Every member below is declared as a METHOD
// rather than as a property holding a function. Method parameters are bivariant,
// which is what lets a free helper typed over `Harness<unknown, object>` accept a
// harness bound to a case's own snapshot type. Rewriting one as
// `until: (…) => …` would make it contravariant under `strictFunctionTypes` and
// break every such helper.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { inject } from "vitest";
import type { Page } from "playwright";
import { fail } from "./assert";
import { ConstantClock, type Clock } from "./clock";
import {
  PROVIDE_SURFACE_ABSENT_KEY,
  PROVIDE_URL_KEY,
  resolveConfig,
  type CaseConfig,
  type ResolvedConfig,
} from "./config";
import { contextFor, openPages } from "./browser";
import { hostFault } from "./host";
import {
  makeFailSurface,
  readSurfaceFault,
  surfaceRequirement,
  unexposedSurface,
} from "./surface";
import { toDrawCall, type DrawCall, type RecordedOp } from "./draw-calls";
import { DEFAULT_FONT, DEFAULT_TEXT_ALIGN } from "./text";
import { mediaDestination } from "./media";
import { type Recording } from "./replay/format";
import { thinReplay } from "./replay/retable";
import {
  decodeRect,
  type EncodedRect,
  type Pixel,
  type PixelRect,
} from "./pixels";
import type { Point } from "./point";
import { fitViewport, toDevice, type Viewport } from "./viewport";

export type { Pixel, PixelRect } from "./pixels";

/** How a harness opens its page, and what it steps in. */
export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to the case's rate. */
  clock?: Clock;
  /** The window's CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /** The seed the opening `reset` is given. Defaults to the case's, if it has one. */
  seed?: number;
  /**
   * Give the build a real, browser-trusted gesture, so its audio can open.
   *
   * OPT IN, and off by default: the gesture is a genuine browser event, which is
   * the whole point of it, so the game is free to act on it — and a check that is
   * not about sound has nothing to gain from handing the build one. Only the
   * suites that read what a build SOUNDED ask for it, so a fault here can only
   * reach the checks that needed it.
   *
   * What it costs the checks that do ask is nothing, because of WHEN it happens:
   * the gesture is delivered before the opening `reset`, so whatever it moved is
   * put back before the harness is handed over. See {@link ArmGesture}.
   */
  armAudio?: boolean;
  /**
   * Something to do to the page after it is opened and BEFORE the build is
   * loaded into it.
   *
   * The one moment a case can reach that this package cannot supply for it: a
   * scenario about what the build does when a file it produced does not arrive
   * has to be routing the request before the navigation, and the navigation
   * happens in here. Everything else a case arranges it arranges through the
   * surface, after the harness is handed over.
   *
   * Kept deliberately narrow. It is handed the Playwright page and nothing else,
   * it is awaited, and a case that does not pass one pays nothing — no route is
   * installed, no crossing is made, and the page is navigated exactly as before.
   * It is not a general extension point for driving the build: an operation a
   * check makes on the game belongs on the case's debug surface, where the
   * case's specification declares it.
   */
  beforeLoad?: (page: Page) => Promise<void>;
}

/**
 * How far a sweep may run, and how many frames separate two samples.
 *
 * BOTH SPELLINGS OF THE BOUND ARE ACCEPTED, and they mean the same thing. Two of
 * the four cases count in frames and two in ticks; a sweep counts whatever the
 * case's step operation runs one of.
 */
export interface UntilOptions {
  /** The bound, in frames. */
  maxFrames?: number;
  /** The bound, in ticks. The same bound; two cases spell it this way. */
  maxTicks?: number;
  /** How many frames to run between two samples of the predicate. */
  poll?: number;
}

/**
 * What a sweep found: whether the predicate ever held, and where it stopped.
 *
 * `frames` and `ticks` are the SAME number under two names, filled from one
 * counter, so a suite written in either vocabulary reads the answer it expects.
 */
export interface UntilResult<S> {
  hit: boolean;
  /** Frames run before the sample that ended the sweep. */
  frames: number;
  /** The same count, for a suite that counts in ticks. */
  ticks: number;
  snapshot: S;
}

/* ---- Batched surface calls ------------------------------------------------ */
//
// WHAT THESE FOUR TYPES ARE FOR. A crossing into the page is a round trip to the
// browser, and what a round trip costs is a fact about how busy the HOST is
// rather than about the build — 6 ms on an idle machine and 90 ms on one running
// a model's build beside it. A scenario that poses forty drones one call at a
// time, or sweeps a hundred frames one round trip apart, has therefore made its
// own verdict a reading of the load average. The batched members below
// (`arrange`, `sweep`, `samples`, `trials`) each do the whole of such a scenario
// in ONE crossing, and these are the shapes they carry.
//
// THE CALL TUPLE IS TYPED AGAINST THE CASE'S OWN SURFACE, operation by operation,
// so a batched call is checked exactly as the direct `h.debug.x(…)` it replaces
// would be. That is the whole reason it is a mapped type rather than
// `[string, ...unknown[]]`: a batch is where a typo in an operation name or a
// missing argument would otherwise reach the page as a raw `TypeError` several
// frames into a scenario.
//
// WHY THE BATCH IS `arrange` AND NOT `pose`. Two cases mean different things by
// the word, and this package's rule is to NEVER SILENTLY PICK A WINNER. Cascade
// already carries a `pose(calls)` of its own — `{ op, args }` objects, answering
// what each call RETURNED — and its `Harness` extends this one, so a member named
// `pose` here would not merely shadow that reading, it would stop cascade
// compiling. The reading below is the other one: a TUPLE checked against the
// case's own surface, answering the SNAPSHOT the calls left. So both ship, under
// names that say which is which, and a case binds the one it has always meant.
// {@link PoseOperation} keeps the word because a type-level name collides with
// nothing and "the operations that pose the game" is exactly what it names.

/**
 * The operations of a case's debug surface `D` that a batch may carry.
 *
 * `snapshot` is excluded by default because it is not an arrangement: a batch
 * hands the state back already, and a `snapshot` inside one would be a reading
 * thrown away.
 *
 * THE STEP OPERATION IS NOT EXCLUDED HERE, AND CANNOT BE. Its name is the case's
 * and arrives through `CaseConfig.step` as a VALUE, which no type in this package
 * can see — refract, carom and fathom spell it `advance` and volute spells it
 * `step`, which is the same disagreement `BASE_REQUIRED_OPS` stops short of. So
 * `Excluded` is a parameter: a case that wants its own step operation kept out of
 * its batches names it (`SurfaceCall<SpectraDebugApi, "snapshot" | "advance">`),
 * and the package's default excludes only the one name every case shares. A batch
 * that does step the game is not rejected — it is simply a batch whose frames the
 * harness did not count, which is why a case is better off naming the exclusion.
 */
export type PoseOperation<
  D,
  Excluded extends PropertyKey = "snapshot",
> = Exclude<Extract<keyof D, string>, Excluded>;

/**
 * One call into the build's surface: the operation's name, then its arguments.
 *
 * A discriminated union over the surface, so `["setDroneBand", 3, "low"]` type
 * checks against `setDroneBand(id: number, band: Band)` and
 * `["setDroneBand", 3]` does not. A member of `D` that is not a function
 * contributes nothing to the union rather than contributing a broken tuple.
 */
export type SurfaceCall<D, Excluded extends PropertyKey = "snapshot"> = {
  [K in PoseOperation<D, Excluded>]: D[K] extends (...args: never[]) => unknown
    ? readonly [K, ...Parameters<D[K]>]
    : never;
}[PoseOperation<D, Excluded>];

/**
 * How far an in-page sweep may run, and what it arranges before it opens.
 *
 * Generic in the CALL rather than in the surface, like every other batched shape
 * here — see {@link Harness}'s third type parameter for why that matters.
 */
export interface SweepOptions<Call> extends UntilOptions {
  /** Surface calls run before the first reading, in the sweep's own crossing. */
  arrange?: readonly Call[];
}

/** What an in-page sweep found, and the state its `arrange` left before it ran. */
export interface SweepResult<S> extends UntilResult<S> {
  /** The state the sweep's own `arrange` left, read before the first frame. */
  arranged: S;
}

/** What a per-frame reading run reads, and when it stops early. */
export interface SamplesOptions<S, Sample, Argument> {
  /** The reading taken off each state. Carried into the page AS SOURCE. */
  project: (snapshot: S, argument: Argument) => Sample;
  /** Everything from the suite the two functions may see. Crosses as JSON. */
  argument: Argument;
  /** Ends the run early, on the reading it held for. Carried in AS SOURCE. */
  stop?: (sample: Sample, taken: Sample[], argument: Argument) => boolean;
}

/** What a per-frame reading run found. */
export interface SamplesResult<S, Sample> {
  /** The opening reading, then one per frame that ran. */
  samples: Sample[];
  /** The state the last frame left. */
  snapshot: S;
  /** How many frames actually ran, which `stop` may have cut short. */
  frames: number;
}

/** How a probing run arranges each of its rounds, and what it reads back. */
export interface TrialsOptions<Call, S, Reading, Argument> {
  /**
   * The calls that arrange one round, from its index and the previous round's
   * reading. Carried into the page AS SOURCE.
   */
  stage: (
    round: number,
    last: Reading | null,
    argument: Argument,
  ) => readonly Call[];
  /** The reading taken off the state a round's frame left. Carried in AS SOURCE. */
  read: (snapshot: S, argument: Argument) => Reading;
  /** Everything from the suite the two functions may see. Crosses as JSON. */
  argument: Argument;
  /**
   * Every surface operation `stage` may issue, checked before the crossing opens.
   *
   * A build missing one then fails by assertion naming the operation rather than
   * with a raw `TypeError` from inside the page. A call to an operation not named
   * here is not checked, so name them all.
   */
  operations: readonly string[];
}

/** What a probing run found. */
export interface TrialsResult<S, Reading> {
  /** One reading per round, in order. */
  readings: Reading[];
  /** The state the last round's frame left. */
  snapshot: S;
}

/**
 * How long a free-running watch may last, and how often it reads.
 *
 * Both are ceilings on the HOST rather than measurements of the build: what
 * {@link Harness.runUntil} reports is how far the BUILD's own clock got, so a
 * machine that starves the frame callback makes the wait longer rather than
 * making the reading smaller.
 */
export interface RunUntilOptions {
  /**
   * The real time the build's own loop is given. Defaults to
   * {@link RUN_UNTIL_TIMEOUT_MS}.
   */
  timeoutMs?: number;
  /** The real interval between readings. Defaults to {@link RUN_UNTIL_POLL_MS}. */
  pollMs?: number;
}

/** What a free-running watch found. */
export interface RunUntilResult<S> {
  /** Whether the predicate ever held before the deadline. */
  hit: boolean;
  /** The reading that ended the watch. */
  snapshot: S;
  /** The real time the loop was left running, in milliseconds. */
  elapsedMs: number;
}

/**
 * A sound the build emitted, and the frame of the drive it emitted it on.
 *
 * `frame` and `tick` are the same 1-based counter under two names, for the same
 * reason {@link UntilResult} carries both.
 */
export interface TimedCue {
  /** The frame it sounded on, 1-based, as {@link Harness.frame} reports. */
  frame: number;
  /** The same frame, for a suite that counts in ticks. */
  tick: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
}

/**
 * Everything a check reads off one page running one build.
 *
 * `S` is the case's snapshot and `D` its debug surface, neither of which this
 * file ever interprets. `Call` is DERIVED from `D` and is never written by a
 * case: `Harness<RefractSnapshot, RefractDebugApi>` is what a case binds, exactly
 * as it always was, and the third parameter fills itself in.
 *
 * WHY IT IS A PARAMETER RATHER THAN `SurfaceCall<D>` WRITTEN AT EACH USE. The
 * batched members take a batch of calls, so `D` would appear both covariantly
 * (`debug: D`, the surface a check reaches through) and contravariantly (a
 * parameter position, in `SurfaceCall<D>`). TypeScript measures a type
 * parameter's variance once for the whole interface and compares two
 * instantiations by it, so `D` would come out INVARIANT — and every free helper
 * the cases write over `Harness<unknown, object>` would stop accepting a harness
 * bound to a real surface, with an error about `{}` missing that surface's
 * operations. Naming the call type separately keeps `D` covariant and leaves
 * `Call` purely contravariant, which is the truth about both: a surface is read
 * OUT of the harness and a batch is passed IN. `SurfaceCall<object>` is `never`,
 * which is why such a helper goes on accepting every case's batch.
 *
 * A case that wants to write the call type down names it off its own surface
 * (`type SpectraCall = SurfaceCall<SpectraDebugApi, "snapshot" | "advance">`)
 * rather than reaching for this parameter.
 */
export interface Harness<S, D, Call = SurfaceCall<D>> {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /** The case this harness was built for, with every default filled in. */
  readonly config: ResolvedConfig;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off the build's own global and never constructed here — see
   * `unexposedSurface`.
   */
  readonly debug: D;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was FOUND, and the
   * failure pairs it with what the specification REQUIRES. Every operation fails
   * by assertion with that pair rather than throwing, so the fault lands on the
   * points whose checks reach the game through the surface.
   */
  readonly surfaceFault: string | null;
  /**
   * The state the build stood the game up in, read before anything reset it, or
   * `null` when the case did not ask for it or the surface could not be driven.
   *
   * A specification that says of a screen "the game opens here" is stating a fact
   * about what a fresh game OPENS on, not about what a `reset` puts it back to,
   * and every check runs after this harness's opening reset — so that half of the
   * requirement would be invisible without a reading taken first. Off by default:
   * it is a real call into the build's surface, and a case that never reads it
   * should not be charged one.
   */
  readonly openingSnapshot: S | null;
  /**
   * The `screen` field of {@link openingSnapshot}, when it has one.
   *
   * Typed loosely on purpose: the package never interprets a snapshot, and a
   * screen name is compared against a string literal at the one call site that
   * reads it.
   */
  readonly openingScreen: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];
  /**
   * Where {@link watchCues} attaches: one array per watcher, each collecting the
   * cues from the frame the watcher was opened on.
   *
   * Exposed rather than kept in a private table alone, so a case that wraps a
   * harness — spreading it to override one member — carries the sinks with it
   * instead of quietly getting a watcher that never fills.
   */
  readonly cues: TimedCue[][];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The same counter, for a suite that counts in ticks. */
  tick(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<S>;
  /**
   * Run `count` frames back to back, each closed as one recorded frame.
   *
   * Each frame is opened and closed around a single step of the build's surface,
   * all inside one synchronous evaluation, so nothing the page's own animation
   * frame renders can land inside a recorded frame — and so a frame the recorder
   * keeps is exactly one frame the game ran.
   *
   * ANSWERS NOTHING, WHERE {@link step} ANSWERS THE STATE THE FRAMES LEFT. That
   * is not an oversight in the union and it is not a narrowing either: it is what
   * all three cases that spell the drive this way declare, and a suite is written
   * against its own case's declaration. Widening it to the snapshot would be a
   * SILENT contract change for them — an `advance` handed to a helper that takes
   * a `() => Promise<void>` stops compiling, which is a suite rewrite, and there
   * is nothing to gain: a suite that wants the state reads it with
   * {@link snapshot}, which is what every one of those call sites already does.
   */
  advance(count?: number): Promise<void>;
  /**
   * The same drive, answering the state the frames left.
   *
   * The one case that spells it this way reads that state at nearly every call
   * site, so this half of the pair carries it. Both names run the same frames
   * through the same body; they differ only in what they hand back.
   */
  step(count?: number): Promise<S>;
  /**
   * Run `count` frames in one batched call, closing no recorded frame.
   *
   * The same simulation as {@link advance} — the frames are the build's own and
   * nothing is fabricated — and the same cost to the game. What it saves is a
   * capture's budget: a march to a state spends none of the frames a reviewer
   * looks at.
   */
  skip(count?: number): Promise<void>;
  /**
   * Run `span` seconds of simulated time, divided into `frames` frames, in ONE
   * call to the build's step operation.
   *
   * THE POINT IS WHO DIVIDES THE INTERVAL. {@link advance} runs `n` frames by
   * making `n` calls of one frame each, so the harness fixes every boundary; this
   * makes a single `op(span, frames)` and leaves the division to the BUILD. That
   * is the only way to pose `advanceSeconds(1, 1)` against `advanceSeconds(1, 60)`
   * — the same second of game time as one frame and as sixty — which is exactly
   * what a specification requiring delta-time independence says must reach the
   * same state.
   *
   * ONLY MEANINGFUL FOR A `"seconds-frames"` STEP, and it THROWS for the other.
   * A `"count"`-step build is never told a duration: its step operation runs whole
   * ticks of the build's own fixed length, so there is no interval for it to
   * divide and nothing to vary the division of. Handing one a span would either
   * silently run the wrong number of ticks or be silently ignored, and both leave
   * a check that is ABOUT the division passing without having posed anything. It
   * throws rather than failing by assertion because it is not a fault of the
   * build: it is a case whose config and whose suite disagree, which no build can
   * cause and none can fix.
   *
   * THE WHOLE SPAN IS ONE RECORDED FRAME. The recorder brackets the single call,
   * which is the honest reading — the harness cannot see where the build put its
   * own frame boundaries inside a step it did not drive. {@link skipSeconds} is
   * the same call with no frame kept.
   *
   * THE CLOCK IS NOT ASKED, and no delta is drawn from it. Every other drive
   * takes the length of a frame from `HarnessOptions.clock`, because it is the
   * harness that decides where the boundaries fall; here the CALLER names the
   * interval and the build divides it, so there is nothing for a clock to say. A
   * stepping or jittered clock is therefore left exactly where it stood, and the
   * simulated time this adds is the span itself.
   *
   * Answers nothing, exactly as {@link advance} does: a suite that wants the
   * state reads it with {@link snapshot}.
   *
   * `frames` is ASSERTED to be at least 1 and a whole number. A count of zero or
   * a fraction is a mistake in the fixture, and it fails as one rather than being
   * quietly repaired into a drive the check did not ask for.
   */
  advanceSeconds(span: number, frames?: number): Promise<void>;
  /**
   * {@link advanceSeconds}, closing no recorded frame.
   *
   * The pair {@link advance} and {@link skip} already are, in the seconds
   * vocabulary: the same real update the build runs, the same one crossing, but
   * off camera, so a capture running across it keeps nothing and a section that
   * has to sit through a stage's entrance costs a replay nothing. Use it for the
   * wait; use {@link advanceSeconds} for the part a check is about.
   *
   * Sounds emitted anywhere inside the span are attributed to the frame it ended
   * on, which is the whole of what an undivided call can honestly say about when
   * a sound happened.
   */
  skipSeconds(span: number, frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: S) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult<S>>;
  /** The same sweep. Two of the four cases spell it this way. */
  stepUntil(
    predicate: (snapshot: S) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult<S>>;
  /** The same sweep on {@link skip}: a march to a state, filmed by nothing. */
  skipUntil(
    predicate: (snapshot: S) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult<S>>;

  /* ---- One crossing instead of N -------------------------------------- */
  //
  // Four members that do in the page what the members above do a round trip
  // apart. Nothing here changes what the build runs, what a recording keeps or
  // what a cue watch sees: the frames are the same frames {@link advance} runs,
  // one step of the build's surface each, opened and closed on the recorder and
  // accounted to the cue sinks the same way. What changes is that a scenario
  // pays for ONE round trip rather than one per call, and a round trip's cost is
  // a fact about how busy the host is — so a check that spent a hundred of them
  // had made its verdict a reading of the load average.
  //
  // WHAT A CASE GIVES UP FOR THAT. Every function below is carried into the page
  // AS SOURCE, so each must stand on its own: it sees the parameters it is handed
  // and nothing else, and anything from the suite reaches it through `argument`,
  // which crosses as JSON. A function that reaches for a binding of the suite's
  // fails IN THE PAGE and the check reports it, so the mistake is loud.
  //
  // AND WHERE `CaseConfig.projectSnapshot` STOPS. A case's narrowing is a node-
  // side function, so it cannot run in the page: the `S` values these hand back —
  // a sweep's `snapshot` and `arranged`, a run's final `snapshot` — are projected
  // exactly as every other snapshot is, but the `Sample` and `Reading` values are
  // the check's OWN readings, taken in the page off an unprojected state. A case
  // that narrows a field should not read that field in a `project` or a `read`.

  /**
   * Run several of the build's surface operations, in order, in ONE crossing,
   * and read the state they left.
   *
   * The same calls the build would receive one at a time, in the same order,
   * against the same game: the surface is synchronous inside the page, so a batch
   * and a run of separate calls leave the game in the same arrangement. Nothing
   * here advances it, so no frame is opened and the recorder keeps nothing — a
   * pose is an arrangement, and {@link advance} is what runs it.
   *
   * NOT SPELLED `pose`, AND THAT IS DELIBERATE: cascade's harness already binds
   * that name to a different reading of its own, which answers what each call
   * RETURNED rather than the state they left. See the section header above.
   */
  arrange(calls: readonly Call[]): Promise<S>;
  /**
   * {@link until}, with the predicate decided INSIDE the page, so the whole sweep
   * is one crossing.
   *
   * Identical in what it drives and what it reports: the same frames, the
   * predicate read before the first and after every `poll` of them, and the sweep
   * stopping on the frame it first holds. What changes is that the frames and the
   * readings happen in the page rather than a round trip apart.
   *
   * `options.arrange` runs surface calls first, in the same crossing, exactly as
   * {@link arrange} would; the state they left is read once and handed to the
   * predicate as its third parameter and back to the caller as
   * {@link SweepResult.arranged}. That is what lets a shot be fired and followed
   * to its contact with no round trip in between.
   *
   * THE UNUSED DELTAS GO BACK TO THE CLOCK. A sweep asks for every delta it might
   * run before it crosses, because the frames run in the page; a sweep that
   * stopped early hands the rest back through `Clock.rewind`, so a stepping or
   * jittered clock is left exactly where the frames that actually ran put it.
   */
  sweep<Argument>(
    predicate: (snapshot: S, argument: Argument, arranged: S) => boolean,
    argument: Argument,
    options?: SweepOptions<Call>,
  ): Promise<SweepResult<S>>;
  /**
   * Run `frames` frames, reading `project` off the state before the first and
   * after every one of them, in ONE crossing.
   *
   * What a check that MEASURES A PATH runs: it wants a reading per frame rather
   * than a stopping point, and taking those readings a round trip apart makes
   * what the check costs a fact about how busy the host is. Keeping a reading to
   * the fields the check uses is what keeps the one crossing small.
   *
   * The array holds `frames + 1` readings: the state as the run opened, then one
   * after each frame — or fewer, when `stop` ends it early. The reading `stop`
   * held on is KEPT, so a caller reads the pair a change sits between.
   */
  samples<Sample, Argument>(
    frames: number,
    options: SamplesOptions<S, Sample, Argument>,
  ): Promise<SamplesResult<S, Sample>>;
  /**
   * Run `rounds` rounds of "pose, drive ONE frame, read" inside the page, in ONE
   * crossing.
   *
   * The sweep a check that PROBES runs. {@link sweep} poses once and then drives,
   * and {@link samples} drives without posing at all; a trial is the shape left
   * over, where each round has to be arranged from what the round before it left
   * — a timer posted just under a bound and the one frame that settles whether
   * the build acted on it, a hundred times over.
   *
   * `stage` is handed the round's index and the PREVIOUS round's reading, and
   * returns the calls that arrange the round, exactly the batch {@link arrange}
   * would run. `read` projects the state the round's frame left; a reading is
   * handed straight to the next round's `stage` inside the page and every one of
   * them comes back at the end, so a reading must be JSON.
   */
  trials<Reading, Argument>(
    rounds: number,
    options: TrialsOptions<Call, S, Reading, Argument>,
  ): Promise<TrialsResult<S, Reading>>;

  /**
   * Run one frame at a time, handing each frame's snapshot to `watch`, and stop
   * when it answers `true`.
   *
   * What a check about a CADENCE reads. The whole history is handed back, so a
   * check can say what happened on every frame before the one it stopped on.
   */
  stepWatching(
    count: number,
    watch?: (snapshot: S, frame: number) => boolean,
  ): Promise<S[]>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;
  /**
   * Hand the game back to its own frame loop, let REAL time pass until
   * `predicate` holds of a fresh reading, then take the loop back.
   *
   * NOT A THIRD SPELLING OF {@link until}, AND NOT {@link runFor} WITH A
   * PREDICATE. `until` DRIVES the game — it runs frames itself and samples
   * between them — and `runFor` hands the loop back for a fixed stretch of wall
   * clock and asks nothing. This does neither: nothing here steps the game, the
   * build's own loop is what moves it, and the only thing this does while it runs
   * is read. That is what makes it the one operation a check ABOUT the loop
   * running can use — a check that drove the frames itself would witness this
   * harness advancing the game, not the build.
   *
   * What bounds the wait is the build's own clock reaching the predicate, not a
   * fixed stretch of wall clock, so a busy host makes the watch take longer
   * rather than making the reading smaller. {@link RunUntilOptions.timeoutMs} is
   * only the point at which the watch gives up, and reaching it means the loop
   * never ran — which is the failure such a check is looking for.
   */
  runUntil(
    predicate: (snapshot: S) => boolean,
    options?: RunUntilOptions,
  ): Promise<RunUntilResult<S>>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one frame that delivers it, and release it.
   *
   * A press that ran no frame would never reach a build that reads its actions
   * once per frame as a press edge, and a press released before a frame ran would
   * be invisible to a build that compares held state between frames — so the
   * frame goes between the two. Exactly one frame passes either way, so nothing a
   * caller counts moves.
   */
  tap(code: string): Promise<S>;
  /** Hold `code` for `count` frames, then release it. */
  holdFor(code: string, count: number): Promise<S>;

  /** Move the pointer to a logical point, in CSS pixels. */
  movePointer(x: number, y: number): Promise<void>;
  /**
   * Press and release a mouse button over the stage, running one frame between.
   *
   * The pointer is moved to the point first, so a build that reads an aim from
   * the pointer reads the point pressed.
   */
  clickPointer(x: number, y: number, button?: "left" | "right"): Promise<S>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Every operation the last CLOSED frame's render issued, without driving one. */
  lastCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): Point;
  /**
   * Where a logical point lands in CSS pixels, taken through the DEVICE mapping.
   *
   * The device point is rounded to a whole pixel and then divided by the device
   * pixel ratio, so this answers "the CSS position of the pixel a logical point
   * lands on". {@link cssPoint} answers the unrounded question directly in CSS
   * units. The two agree wherever the device point is already whole, which is
   * every shape a check runs at bar the ones that are ABOUT the fit — they are
   * kept apart because the cases that use them measure different things.
   */
  css(x: number, y: number): Point;
  /** Where a logical point lands in CSS pixels, in CSS units throughout. */
  cssPoint(x: number, y: number): Point;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<Pixel>;
  /** Many logical points at once, in one crossing into the page. */
  pixels(points: readonly Point[]): Promise<Pixel[]>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<Pixel>;
  /**
   * A rectangle of the canvas, addressed in logical units and read back as RGBA.
   *
   * The rectangle is `width` x `height` LOGICAL units with its top-left at
   * `(x, y)`; at the harness's default shape that is one device pixel per unit,
   * so a 28 x 28 read is the 28 x 28 sprite the build drew there.
   */
  pixelRect(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PixelRect>;
  /**
   * The channel-mean brightness of every device pixel along one line of the
   * backing store, addressed past the fit.
   *
   * One crossing into the page for the whole line, because a check that has to
   * find WHERE the build drew something reads thousands of pixels rather than a
   * handful, and a crossing each would cost more than the frame it is reading.
   */
  scanDevice(axis: "row" | "column", index: number): Promise<number[]>;
  /**
   * The RGBA bytes of a source a frame drew, by its `ImageRef` id.
   *
   * The produced file itself, at its own natural size, rather than the corner of
   * the stage it landed on — which is what a check about a sprite's own pixels
   * needs. `null` when the page no longer holds that source.
   */
  imagePixels(id: number): Promise<PixelRect | null>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /**
   * Give the build a real, browser-trusted gesture, so its audio can open — at
   * whatever moment the check has reached.
   *
   * THE SAME GESTURE `HarnessOptions.armAudio` DELIVERS, AND NOT THE SAME THING.
   * The option fires it in the one place the harness controls: before the opening
   * `reset`, with settling frames after it, so the restore erases whatever the
   * gesture moved and a check is handed a game nothing has touched. That is the
   * safe position, and it is why the option exists — but it is a position only
   * the harness can occupy, because it is inside `createHarness`.
   *
   * This method is the gesture and nothing else: no settling frames and no
   * reset, because it is called at a moment the harness arranged nothing about
   * and repairing the state afterwards would erase the check's own arrangement
   * along with the gesture's. A case reaching for it is stating that its gesture
   * is inert where it stands — a key its specification binds to nothing, pressed
   * on a screen that reads no keys — or that it wants what the gesture did. A
   * case that only needs its audio open before the checks begin should use the
   * option instead, which cannot leave a mark.
   *
   * Which gesture it is, is the case's ({@link ArmGesture}), and a press is made
   * at the case's own LOGICAL point taken through the fit, so it lands where the
   * case says it does whatever shape the window is.
   */
  armAudio(): Promise<void>;
  /** How many sounds the build has emitted since the page loaded, in total. */
  sounds(): Promise<number>;
  /**
   * How many of the sources the build started are still live and LOOPING.
   *
   * A build that runs a bed by setting `loop` on its source is read directly
   * here. One that instead re-schedules the buffer end to end is equally
   * conformant and reports zero, so a check about a bed pairs this with
   * {@link sounds}: a bed that is sounding at all is the weaker reading every
   * conformant build satisfies.
   */
  loopingSounds(): Promise<number>;
  /** How many of the sounds emitted were looping when they started. */
  loopStarts(): Promise<number>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<object, TimedCue[][]>();

/** How far a sweep runs when the caller names no bound. */
const DEFAULT_MAX_FRAMES = 600;

/**
 * How long {@link Harness.runUntil} leaves the build's own loop running before it
 * gives up on the predicate.
 *
 * The deadline is the ONLY wall clock a free-running watch answers to, and it is
 * a ceiling rather than a measurement: what a watch reports is how far the
 * build's own clock got, so the deadline only has to be long enough that a
 * machine which starves the loop still lets a running build reach its floor.
 * Thirty seconds is two orders of magnitude more real time than a healthy loop
 * needs for the quarter second of game time the checks that use it ask for, and
 * it sits well inside the five-minute test budget `vitest-config.ts` states, so a
 * build that genuinely never runs its loop is reported here — where this package
 * can say which wait was crossed — rather than as a check that timed out.
 */
export const RUN_UNTIL_TIMEOUT_MS = 30_000;

/**
 * How often a free-running watch reads the build's clock, in real milliseconds.
 *
 * Fifty, because the reading is a crossing into the browser and a crossing costs
 * 6 ms on an idle host and 90 ms on a loaded one: poll much faster and the watch
 * spends its budget on the READING rather than on the loop it is watching, on
 * exactly the busy host where the loop needs the room. Nothing rests on the
 * granularity — the watch reports the build's own clock, not the moment this
 * noticed it.
 */
export const RUN_UNTIL_POLL_MS = 50;

/**
 * How long the recorder's 2D context is waited for before a harness gives up on
 * it.
 *
 * Nothing about a verdict rests on this: the wait only decides whether a replay
 * has frames in it, so it is bounded well below the surface probe's ceiling
 * (`DEFAULT_SURFACE_TIMEOUT_MS`, which a case may raise further) rather than
 * paid at the surface's length on every harness of a build that draws nothing.
 * A build takes its context on the frame it first draws at the latest, which on
 * any host that got the page loaded at all is inside five seconds; a build that
 * has not drawn by then is failed by the checks that read its pixels, on its own
 * account, and losing its replay costs it nothing further.
 */
export const RECORDER_READY_TIMEOUT_MS = 5_000;

/**
 * How often the recorder wait asks the page, in milliseconds.
 *
 * A fixed interval rather than Playwright's default, which schedules
 * `waitForFunction` on the PAGE's own `requestAnimationFrame`: a page whose
 * frames are starved is exactly the page this wait is asking about, and one
 * polled on its frames would be seen late — or, for a build that never schedules
 * a frame, never looked at again. The same reasoning `surface.ts` gives for
 * `SURFACE_POLL_MS`, and the same tenth of a second; kept as its own constant
 * rather than borrowed, because the two waits are independent and neither has to
 * move when the other does.
 */
const READY_POLL_MS = 100;

/**
 * The ceiling on every operation PLAYWRIGHT itself times against the page.
 *
 * WHY THIS CONSTANT EXISTS. Playwright leaves a deadline on anything it has to
 * wait for — a navigation, a screenshot, a keyboard event delivered to a busy
 * renderer — and that deadline defaults to thirty seconds. Nothing here asked for
 * it, so nothing here reasoned about it, and it is the same mistake the surface
 * probe's own ceiling was written to avoid: every one of those waits is a wait on
 * the HOST, and none of them is a claim about the build. A build whose canvas the
 * compositor was slow to hand back is a build failed for the load average. This
 * is the `host.ts` principle applied to the one clock this package did not set.
 *
 * A MINUTE. Each of these waits ends the instant the page answers, so a healthy
 * build pays none of it however high it is set; what the number has to be is
 * large enough that a loaded host cannot cross it and small enough to sit inside
 * the hook and test budgets `vitest-config.ts` states (five minutes each), so a
 * page that genuinely never answers still fails here, where this package can say
 * what happened, rather than on the runner. A project holds several pages of one
 * browser open at once on a machine that is also running a model's build, and a
 * crossing into one costs 6 ms idle and 90 ms loaded; a minute is nearly three
 * orders of magnitude above the loaded figure.
 */
export const PAGE_DEADLINE_MS = 60_000;

/**
 * How many frames run between the arming gesture and the opening `reset`.
 *
 * Not a settling time, a READING time: the frames on which a build's own input
 * layer consumes the gesture, so that whatever it does with it is in the state
 * the `reset` then restores. Two, because that is the most a conformant build
 * takes to read a press and its release.
 */
const ARM_SETTLE_FRAMES = 2;

/** The page's globals, as the shapes the evaluations below reach for. */
type PageGlobals = Record<
  string,
  Record<string, (...args: unknown[]) => unknown>
>;

/** A sweep's answer, with the one count written under both its names. */
function swept<S>(hit: boolean, count: number, snapshot: S): UntilResult<S> {
  return { hit, frames: count, ticks: count, snapshot };
}

/**
 * Advance until `predicate` holds, over whichever of the two drives the caller
 * chose.
 *
 * GUARD AGAINST A VACUOUS PASS. The first read is taken BEFORE anything is
 * driven, so a sweep reports a hit at zero frames when the predicate already
 * held. That is the honest answer, and it is also the trap: a check that sweeps
 * for "the game left live play" without first establishing that it was IN live
 * play passes on a game that was never playing. Capture the state the scenario
 * needs before the sweep, not from the sweep.
 */
async function sweep<S>(
  read: () => Promise<S>,
  run: (count: number) => Promise<S>,
  predicate: (snapshot: S) => boolean,
  options: UntilOptions,
): Promise<UntilResult<S>> {
  const max = options.maxFrames ?? options.maxTicks ?? DEFAULT_MAX_FRAMES;
  const poll = Math.max(1, options.poll ?? 1);

  let snapshot = await read();
  if (predicate(snapshot)) return swept(true, 0, snapshot);

  let count = 0;
  while (count < max) {
    const stride = Math.min(poll, max - count);
    snapshot = await run(stride);
    count += stride;
    if (predicate(snapshot)) return swept(true, count, snapshot);
  }
  return swept(false, count, snapshot);
}

/* ---- Measuring the text a frame drew --------------------------------------- */

/** One text call, and the text state the walk found in force at it. */
interface PendingMeasure {
  call: Extract<DrawCall, { kind: "call" }>;
  text: string;
  font: string;
  textAlign: string;
}

/**
 * Attach a measured width and the alignment in force to every text call of a
 * recorded frame.
 *
 * The recorder records `font` and `textAlign` as ordinary property sets, and
 * `save`/`restore` stack them exactly as they stack the transform, so the state
 * at each call is recovered by walking the frame. The widths themselves are
 * measured IN THE PAGE, against an offscreen 2D context, so a run is measured
 * under the build's own loaded fonts — in ONE crossing, over the distinct
 * (text, font) pairs the frame used, however many calls spelled them.
 *
 * The walk starts from the context's own defaults, because a frame's operation
 * list holds what that frame issued and not what it inherited. A build that sets
 * its font every frame, which is the ordinary render, is measured exactly; one
 * that sets it once and relies on the inheritance is measured against the
 * default font, which under-reports the width and so only ever leaves runs apart
 * that would otherwise have joined.
 */
async function measureTextCalls(page: Page, calls: DrawCall[]): Promise<void> {
  const pending: PendingMeasure[] = [];
  const stack: { font: string; textAlign: string }[] = [];
  let current = { font: DEFAULT_FONT, textAlign: DEFAULT_TEXT_ALIGN };

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "font" && typeof call.value === "string") {
        current = { ...current, font: call.value };
      } else if (
        call.property === "textAlign" &&
        typeof call.value === "string"
      ) {
        current = { ...current, textAlign: call.value };
      }
      continue;
    }
    if (call.method === "save") {
      stack.push(current);
      continue;
    }
    if (call.method === "restore") {
      const popped = stack.pop();
      if (popped !== undefined) current = popped;
      continue;
    }
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const text = call.args[0];
    if (typeof text !== "string" || text.length === 0) continue;
    pending.push({
      call,
      text,
      font: current.font,
      textAlign: current.textAlign,
    });
  }
  if (pending.length === 0) return;

  const distinct = new Map<string, { font: string; text: string }>();
  for (const item of pending) {
    distinct.set(measureKey(item.font, item.text), {
      font: item.font,
      text: item.text,
    });
  }
  const wanted = [...distinct.values()];

  const widths = (await page.evaluate((items) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("case-harness: no 2D context to measure text in");
    }
    return items.map((item) => {
      ctx.font = item.font;
      return ctx.measureText(item.text).width;
    });
  }, wanted)) as number[];

  const measured = new Map<string, number>();
  for (const [index, item] of wanted.entries()) {
    measured.set(measureKey(item.font, item.text), widths[index] as number);
  }
  for (const item of pending) {
    item.call.text = {
      width: measured.get(measureKey(item.font, item.text)) ?? 0,
      textAlign: item.textAlign,
    };
  }
}

/**
 * One (font, text) pair as a map key.
 *
 * The separator is a newline, which neither a CSS font shorthand nor a run of
 * canvas text can contain, so no two distinct pairs ever collide on one key.
 */
function measureKey(font: string, text: string): string {
  return `${font}\n${text}`;
}

/**
 * Put the built site in `page`, and say whether `load` had fired by the time the
 * page was handed back.
 *
 * The `load` EVENT is not something a case requires of a build, so it is not
 * something a validator project fails a build for missing. What it is, is the
 * moment after which a conformant build has certainly installed its surface —
 * which is what a case does require, and what {@link readSurfaceFault} reads. So
 * a navigation that runs out of {@link PAGE_DEADLINE_MS} hands over to that
 * reading rather than throwing: a build that wedged its own main thread installs
 * nothing and is failed there on its own account, and a host that was merely slow
 * gets the surface ceiling on top of the one it already had.
 *
 * WHY THE ANSWER IS RETURNED RATHER THAN DISCARDED. The two outcomes read the
 * same from the surface probe and are not the same story: "the surface was still
 * absent 15s after the page loaded" is a claim about the BUILD, while "…after the
 * page was requested, which had still not fired `load` 60s in" is a page that
 * never got as far as being asked. A reading that described the second as the
 * first would send a reviewer looking for a fault that is not there, so the fact
 * travels with the page.
 *
 * A navigation that fails any OTHER way never reached the build at all. The
 * server being asked is the project's own, on loopback, reading files off the
 * same disk the build was produced on; nothing a build does decides whether it
 * answers, so a check that meets one decides nothing and says so.
 */
async function loadBuild(page: Page): Promise<boolean> {
  try {
    await page.goto(inject(PROVIDE_URL_KEY), { waitUntil: "load" });
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return false;
    const detail = error instanceof Error ? error.message : String(error);
    hostFault(
      `the built site could not be fetched from this project's own server (${detail.split("\n")[0]})`,
    );
  }
}

/**
 * Bind {@link Harness} to one case, and hand back the `createHarness` its suites
 * call.
 *
 * TYPES BY GENERICS, VALUES BY CONFIG. `S` is the case's snapshot and `D` its
 * debug surface, neither of which this file ever interprets: a snapshot is
 * carried opaquely from the page to the predicate that reads it, and the surface
 * is a proxy that forwards a name and its arguments. Everything else a case
 * differs in — the handle, the required operations, the stage, the step
 * operation, the arming gesture — arrives in one object.
 */
export function createHarnessFactory<S, D extends object>(
  config: CaseConfig<S>,
): (options?: HarnessOptions) => Promise<Harness<S, D>> {
  const resolved = resolveConfig(config);
  // The case's own narrowing, or none. Held here rather than on `ResolvedConfig`
  // because it is the one member of a case's config that reads the case's own
  // snapshot type, and `ResolvedConfig` is handed to every check as `h.config`.
  const project: (snapshot: S) => S =
    config.projectSnapshot?.bind(config) ?? ((snapshot) => snapshot);
  const requirement = surfaceRequirement(resolved.handle, resolved.specPath);
  const failSurface = makeFailSurface(requirement);
  const tickMs = 1000 / resolved.tickHz;

  return async function createHarness(
    options: HarnessOptions = {},
  ): Promise<Harness<S, D>> {
    const cssWidth = options.cssWidth ?? resolved.stage.width;
    const cssHeight = options.cssHeight ?? resolved.stage.height;
    const dpr = options.dpr ?? 1;
    const clock = options.clock ?? new ConstantClock(tickMs);
    const seed = options.seed ?? resolved.defaultSeed;
    // Both are read by the arming gesture below, which happens before the page is
    // handed to anything else, so neither can wait until the harness is built.
    const view = fitViewport(cssWidth, cssHeight, dpr, resolved.stage);
    const cssPointOf = (x: number, y: number): Point => ({
      x: view.cssOffsetX + x * view.cssScale,
      y: view.cssOffsetY + y * view.cssScale,
    });
    // Reaching the browser and taking a page off it is the project's
    // scaffolding rather than anything the build participates in, so a failure
    // here leaves the check undecided instead of failing a build that was never
    // asked anything. `host.ts` says why that is its own outcome.
    let page: Page;
    try {
      const context = await contextFor({ cssWidth, cssHeight, dpr }, resolved);
      page = await context.newPage();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      hostFault(
        `no page could be opened on the browser this project started (${detail.split("\n")[0]})`,
      );
    }
    openPages.add(page);

    // Whatever this page throws or logs as an error while THIS harness drives
    // it. The page belongs to one harness, so the log cannot pick up what some
    // other check provoked.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(String(error.message || error));
    });
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });

    // Off Playwright's own thirty-second defaults before anything is asked of
    // the page: those are deadlines on the HOST, and this package sets its own.
    // See {@link PAGE_DEADLINE_MS} — every wait they govern (the navigation
    // below, each screenshot, each keyboard event delivered to a busy renderer)
    // ends the instant the page answers, so nothing a healthy build does pays
    // for the higher ceiling.
    page.setDefaultTimeout(PAGE_DEADLINE_MS);
    page.setDefaultNavigationTimeout(PAGE_DEADLINE_MS);

    // Whatever the case has to arrange on the page itself, before the build is
    // fetched into it. See {@link HarnessOptions.beforeLoad}.
    if (options.beforeLoad !== undefined) await options.beforeLoad(page);

    const loaded = await loadBuild(page);

    const surfaceFault = await readSurfaceFault(
      page,
      resolved.handle,
      resolved.requiredOps,
      resolved.surfaceTimeoutMs,
      // Which of two sentences the fault is — see {@link loadBuild}. Passed
      // rather than defaulted, because this is the one caller that knows.
      loaded,
      // The answer `global-setup.ts` already bought for the whole run, on pages
      // of its own and for the whole of the ceiling. Injected here rather than
      // read in `surface.ts`, which may not import the test runtime. Without
      // this the probe's cost is paid once and its saving never taken: every
      // harness of a surface-less build would spend the ceiling again.
      inject(PROVIDE_SURFACE_ABSENT_KEY),
    );
    const refuse = (): never => failSurface(surfaceFault ?? "");

    /**
     * Which of the case's OPTIONAL operations this build does not carry.
     *
     * `surfaceFault` already covers everything every build owes; what this adds
     * is the handful a VARIANT owes (`CaseConfig.optionalOps`). Read once per
     * page, and only for a case that declared any — a case with none pays no
     * crossing at all, which is every case that has no variants to differ over.
     *
     * WHAT IT IS FOR is the failure a check lands on. An overload build with no
     * `setDroneCharge` should fail its overload points with the expected/actual
     * pair a reviewer reads, naming the operation the specification required;
     * without this it fails with a raw `TypeError` from inside the page, several
     * calls into a scenario, which names nothing. It is NEVER a surface fault:
     * the probe that decides whether a build is conformant at all does not look
     * at this list, so a base build missing every one of them is conformant.
     */
    const missingOptional = new Set<string>();
    if (surfaceFault === null && resolved.optionalOps.length > 0) {
      const carried = new Set(
        await page.evaluate(
          ([handle, names]) => {
            const target =
              (window as unknown as Record<string, Record<string, unknown>>)[
                handle
              ] ?? {};
            return names.filter((name) => typeof target[name] === "function");
          },
          [resolved.handle, [...resolved.optionalOps]] as const,
        ),
      );
      for (const name of resolved.optionalOps) {
        if (!carried.has(name)) missingOptional.add(name);
      }
    }

    /**
     * Fail the running check if `operation` is one the build was allowed to omit
     * and did.
     *
     * Applied at every route into the surface a check can take, so no route can
     * reach a missing optional operation and land on a `TypeError` instead.
     */
    const requireOperation = (operation: string): void => {
      if (missingOptional.has(operation)) {
        failSurface(`window.${resolved.handle} carries no ${operation}()`);
      }
    };

    const call = async (
      operation: string,
      args: unknown[],
    ): Promise<unknown> => {
      if (surfaceFault !== null) refuse();
      requireOperation(operation);
      const returned = await page.evaluate(
        ([handle, name, rest]) =>
          (window as unknown as PageGlobals)[handle]![name]!(...rest),
        [resolved.handle, operation, args] as const,
      );
      // One of the points a snapshot crosses back out of the page, and the one
      // every read of the surface's own `snapshot` goes through — `h.snapshot()`,
      // `h.debug.snapshot()`, the opening read, and every sweep. The driven runs
      // below are the others.
      return operation === "snapshot" ? project(returned as S) : returned;
    };

    const debug =
      surfaceFault !== null
        ? unexposedSurface<D>(surfaceFault, failSurface)
        : (new Proxy({} as D, {
            get: (_target, property): unknown => {
              if (typeof property === "symbol") return undefined;
              if (property === "then" || property === "constructor")
                return undefined;
              const name = String(property);
              return (...args: unknown[]) => call(name, args);
            },
          }) as D);

    /**
     * A GENUINE browser gesture, so the build's audio can open.
     *
     * A build is free to open its audio context from a real DOM event alone —
     * both that and an explicit unlock are conformant — so a gesture delivered
     * any other way would leave a perfectly good build silent. Which gesture it
     * is, is the case's ({@link ArmGesture}); a press is made at the case's own
     * LOGICAL point, taken through the fit like every other pointer operation, so
     * it lands where the case says it does whatever shape the window is.
     */
    const armGesture = async (): Promise<void> => {
      if (resolved.arm.kind === "key") {
        await page.keyboard.press(resolved.arm.code);
        return;
      }
      const at = cssPointOf(resolved.arm.x, resolved.arm.y);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.up();
    };

    // What the build opened on, read before the `reset` below puts it back
    // whatever it opened on. Only when the case asked: it is a real call into
    // the build's surface.
    const openingSnapshot =
      resolved.readOpeningSnapshot && surfaceFault === null
        ? ((await call("snapshot", [])) as S)
        : null;

    if (surfaceFault === null) {
      // Off the wall clock and back to the start before a check touches
      // anything: from here the game changes only when this harness says so.
      await call("setAutoStep", [false]);
      // THE AUDIO GESTURE GOES IN BEFORE THAT RESTORE, which is what makes it
      // safe to deliver one at all. It is a real browser event — it has to be, or
      // a build that opens its context from a DOM event alone would stay silent —
      // so the game is entitled to act on it: a press lands wherever the build
      // chose to put its controls, and a case whose specification leaves every key
      // binding to the build has no key that is inert by construction either.
      // Delivered here, neither has to be. The `reset` on the next line restores
      // every declared field of the state, so a menu the gesture took, a screen it
      // left, or a beam it cleared is gone before a check reads anything — while
      // the audio it opened is a fact about the page's user activation, which no
      // reset touches.
      if (options.armAudio ?? false) {
        await armGesture();
        // And the frames the build reads it on, which is the half of the ordering
        // that is easy to miss. An input layer that BUFFERS its samples and reads
        // them once a frame — the shape an engineless build usually writes — has
        // not acted on the gesture yet when this line is reached, and the buffer
        // belongs to that layer rather than to the state, so the `reset` would not
        // empty it: the edges would still be pending, and the first frame a check
        // drove would take them, past the restore meant to erase them. Two frames,
        // because a build is equally free to read one sample per frame, which is
        // what a press and its release take.
        await call(
          resolved.step.op,
          resolved.step.kind === "seconds-frames"
            ? [(ARM_SETTLE_FRAMES * tickMs) / 1000, ARM_SETTLE_FRAMES]
            : [ARM_SETTLE_FRAMES],
        );
      }
      await call("reset", seed === null ? [] : [{ seed }]);
      // And a recorder over the surface before a check can arm one. A build is
      // free to ask for its 2D context on the frame it first draws rather than
      // while it initializes, so the surface can be installed and answering
      // before any context exists to record — and a `captureReplay` armed in
      // that window arms nothing and writes no evidence for a section that drew.
      //
      // ITS OWN CEILING, NOT THE SURFACE'S. What expiring here costs is a REPLAY,
      // never a verdict, so it is bounded well below the probe that decides
      // whether the build is conformant at all: reusing the surface ceiling would
      // charge every harness of a build that draws nothing fifteen seconds (or
      // whatever a case raised its probe to) for evidence that was never coming.
      // See {@link RECORDER_READY_TIMEOUT_MS}.
      await page
        .waitForFunction(
          (rec) =>
            (window as unknown as Record<string, { ready(): boolean }>)[
              rec
            ]!.ready(),
          resolved.recorderGlobal,
          { timeout: RECORDER_READY_TIMEOUT_MS, polling: READY_POLL_MS },
        )
        .catch(() => undefined);
    }

    const cueSinks: TimedCue[][] = [];
    let frameCount = 0;
    let timeMs = 0;

    /**
     * Count `upTo` of the frames a batched run was handed deltas for, and stamp
     * every sound it emitted with the frame that produced it.
     *
     * The accounting the driven loop does inline, lifted out because the batched
     * members below each hand back a sound count per frame and a number of frames
     * that actually ran — which is not always the number they asked for, since a
     * sweep stops on its predicate. Only the frames that RAN move the counters,
     * so `h.frame()` and `h.timeMs()` mean the same thing across a batched sweep
     * as across a driven one.
     */
    const accountFrames = (
      deltas: readonly number[],
      sounds: readonly number[],
      upTo: number,
    ): void => {
      for (let index = 0; index < upTo; index += 1) {
        frameCount += 1;
        timeMs += deltas[index] as number;
        const emitted = sounds[index] ?? 0;
        for (let n = 0; n < emitted; n += 1) {
          for (const sink of cueSinks) {
            sink.push({ frame: frameCount, tick: frameCount, t: timeMs });
          }
        }
      }
    };

    /* ---- The page's own names, as source ---------------------------------- */
    //
    // The batched members carry the check's own functions into the page AS
    // SOURCE, so their bodies are assembled as text rather than passed as
    // arguments — which means the handle, the two instrumentation globals and the
    // step operation have to be written into that text. Each is interned once
    // here, through `JSON.stringify`, so a name is quoted exactly as a string
    // literal however it is spelled and no name is ever concatenated raw into a
    // script.

    /** `window.<handle>`, as an expression. */
    const apiSource = `window[${JSON.stringify(resolved.handle)}]`;
    /** The injected recorder, as an expression. */
    const recSource = `window[${JSON.stringify(resolved.recorderGlobal)}]`;
    /** The injected audio probe, as an expression. */
    const audioSource = `window[${JSON.stringify(resolved.audioGlobal)}]`;
    /**
     * ONE frame of the build's own length, as a statement, given a `dt` in ms.
     *
     * The two step shapes `specs/instrumentation.md` fixes, written out here
     * rather than branched on in the page: a `"seconds-frames"` build is told the
     * length of the frame and a `"count"` build is not, and handing either the
     * other's arguments would run hundreds of ticks for one or integrate a frame
     * of a whole second.
     */
    const stepOneSource =
      resolved.step.kind === "seconds-frames"
        ? `api[${JSON.stringify(resolved.step.op)}](dt / 1000, 1)`
        : `api[${JSON.stringify(resolved.step.op)}](1)`;
    /** The three page globals a batched script opens with, as statements. */
    const preludeSource = `const api = ${apiSource}; const rec = ${recSource}; const audio = ${audioSource};`;
    /** One recorded frame, bracketed and accounted, given `dt` and `sounds`. */
    const recordedFrameSource = `
      const before = audio.started();
      rec.begin();
      ${stepOneSource};
      rec.end(dt);
      sounds.push(audio.started() - before);`;

    /**
     * Run `count` frames and read the state they left, in one crossing.
     *
     * Each frame is opened and closed around a single step of the build's
     * surface, all inside one synchronous evaluation, and the audio probe is read
     * either side of it, so a sound is attributed to the frame that produced it.
     * `sample` asks for the snapshot after every frame rather than only the last,
     * which is what a check about a cadence reads.
     */
    const drive = async (
      count: number,
      sample = false,
    ): Promise<{ snapshots: S[]; sounds: number[] }> => {
      if (surfaceFault !== null) refuse();
      const deltas: number[] = [];
      for (let i = 0; i < count; i += 1) deltas.push(clock.delta());
      const result = (await page.evaluate(
        ([handle, recName, audioName, op, kind, dts, every]) => {
          const globals = window as unknown as PageGlobals;
          const api = globals[handle] as Record<
            string,
            (...args: unknown[]) => unknown
          >;
          const rec = globals[recName] as Record<
            string,
            (...args: unknown[]) => unknown
          >;
          const audio = globals[audioName] as unknown as {
            started(): number;
          };
          const sounds: number[] = [];
          const snapshots: unknown[] = [];
          for (let i = 0; i < dts.length; i += 1) {
            const dt = dts[i] as number;
            const before = audio.started();
            rec.begin!();
            if (kind === "seconds-frames") api[op]!(dt / 1000, 1);
            else api[op]!(1);
            rec.end!(dt);
            sounds.push(audio.started() - before);
            if (every || i === dts.length - 1) snapshots.push(api.snapshot!());
          }
          if (dts.length === 0) snapshots.push(api.snapshot!());
          return { snapshots, sounds };
        },
        [
          resolved.handle,
          resolved.recorderGlobal,
          resolved.audioGlobal,
          resolved.step.op,
          resolved.step.kind,
          deltas,
          sample,
        ] as const,
      )) as { snapshots: S[]; sounds: number[] };
      result.snapshots = result.snapshots.map(project);

      for (const [index, delta] of deltas.entries()) {
        frameCount += 1;
        timeMs += delta;
        const emitted = result.sounds[index] ?? 0;
        for (let n = 0; n < emitted; n += 1) {
          for (const sink of cueSinks) {
            sink.push({ frame: frameCount, tick: frameCount, t: timeMs });
          }
        }
      }
      return result;
    };

    /**
     * Run `count` frames in one batched call, closing no recorded frame, and read
     * the state they left.
     *
     * The same real frames the game runs under {@link drive}; what is skipped is
     * the recording, not the simulation. A specification that has the step
     * operation run `n` whole frames "immediately and in order" is what makes a
     * batch and a run of singles reach the same state.
     */
    const march = async (count: number): Promise<S> => {
      if (surfaceFault !== null) refuse();
      let totalMs = 0;
      for (let i = 0; i < count; i += 1) totalMs += clock.delta();
      const snapshot = (await page.evaluate(
        ([handle, op, kind, howMany, spanMs]) => {
          const api = (window as unknown as PageGlobals)[handle] as Record<
            string,
            (...args: unknown[]) => unknown
          >;
          if (kind === "seconds-frames") api[op]!(spanMs / 1000, howMany);
          else api[op]!(howMany);
          return api.snapshot!();
        },
        [
          resolved.handle,
          resolved.step.op,
          resolved.step.kind,
          count,
          totalMs,
        ] as const,
      )) as S;
      frameCount += count;
      timeMs += totalMs;
      return project(snapshot);
    };

    /**
     * Run `span` seconds as `frames` frames, in ONE call to the step operation.
     *
     * The body behind {@link Harness.advanceSeconds} and
     * {@link Harness.skipSeconds}: the same crossing and the same single call,
     * differing only in whether the recorder brackets it. `who` names the member
     * the caller reached for, so a fixture error names the call the check wrote
     * rather than the helper both share.
     */
    const runSpan = async (
      who: string,
      span: number,
      frames: number,
      keep: boolean,
    ): Promise<void> => {
      if (surfaceFault !== null) refuse();
      // NOT a surface fault and not an assertion about the build: a `"count"`
      // step is never told a duration, so there is no interval for the build to
      // divide and nothing this call could mean. It is a case whose config and
      // whose suite disagree — no build can cause it and none can fix it — so it
      // throws rather than deciding a point either way. See the declaration.
      if (resolved.step.kind !== "seconds-frames") {
        throw new TypeError(
          `${resolved.slug}: ${who} needs a "seconds-frames" step, but this case's ` +
            `step operation is ${resolved.step.op}(count), which runs whole ticks of ` +
            "the build's own length — use advance/skip, which count in those ticks",
        );
      }
      // A fixture error fails as one: a count below one, or a fractional count,
      // is a mistake in the check, and repairing it silently would run a drive
      // nobody asked for.
      if (!Number.isInteger(frames) || frames < 1) {
        fail(`${who} to be given a whole number of frames, at least 1`, frames);
      }
      const spanMs = span * 1000;
      const emitted = (await page.evaluate(
        ([handle, recName, audioName, op, seconds, count, deltaMs, record]) => {
          const globals = window as unknown as PageGlobals;
          const api = globals[handle]!;
          const rec = globals[recName]!;
          const audio = globals[audioName] as unknown as {
            started(): number;
          };
          const before = audio.started();
          if (record) rec.begin!();
          api[op]!(seconds, count);
          // The whole span closes as ONE kept frame, which is the honest
          // reading: the harness cannot see where the build put its own frame
          // boundaries inside a step it did not drive.
          if (record) rec.end!(deltaMs);
          return audio.started() - before;
        },
        [
          resolved.handle,
          resolved.recorderGlobal,
          resolved.audioGlobal,
          resolved.step.op,
          span,
          frames,
          spanMs,
          keep,
        ] as const,
      )) as number;
      // Every frame of the span is counted, but only the frame it ENDED on can
      // carry a cue: an undivided call says nothing about when inside it a sound
      // happened, and spreading them over the span would be an invention.
      frameCount += frames;
      timeMs += spanMs;
      for (let n = 0; n < emitted; n += 1) {
        for (const sink of cueSinks) {
          sink.push({ frame: frameCount, tick: frameCount, t: timeMs });
        }
      }
    };

    /**
     * Check a batch's operations before the crossing opens.
     *
     * A batch is where a missing optional operation would otherwise reach the
     * page as a raw `TypeError` in the middle of a scenario, taking the rest of
     * the batch with it; checked here, the check fails naming the operation the
     * specification required.
     */
    const requireBatch = (calls: readonly (readonly unknown[])[]): void => {
      for (const entry of calls) requireOperation(String(entry[0]));
    };

    /**
     * One animation frame, before a reading, for a case that asked for it.
     *
     * A specification has the step operation redraw the canvas, so on a
     * conforming build the picture is already the one the last frame left — but a
     * build that presents on its own frame instead has drawn the same state a
     * moment later, and waiting costs a sample nothing but a frame. The recorder
     * is in manual mode here, so the frame this waits for closes nothing and no
     * recording sees it.
     */
    const settle = async (): Promise<void> => {
      if (!resolved.awaitFrameBeforeRead) return;
      await page.evaluate(
        () => new Promise<void>((done) => requestAnimationFrame(() => done())),
      );
    };

    const readPixels = async (
      devicePoints: readonly Point[],
    ): Promise<Pixel[]> => {
      await settle();
      return page.evaluate(
        ([slug, points]) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          const first = canvases[0];
          if (first === undefined)
            throw new Error(`${slug}: the page has no <canvas>`);
          let canvas = first;
          for (const other of canvases) {
            if (other.width * other.height > canvas.width * canvas.height)
              canvas = other;
          }
          const ctx = canvas.getContext("2d");
          if (ctx === null)
            throw new Error(`${slug}: the canvas has no 2D context`);
          return points.map((point) => {
            const x = Math.min(
              Math.max(point.x, 0),
              Math.max(canvas.width - 1, 0),
            );
            const y = Math.min(
              Math.max(point.y, 0),
              Math.max(canvas.height - 1, 0),
            );
            const { data } = ctx.getImageData(x, y, 1, 1);
            return [data[0], data[1], data[2], data[3]] as Pixel;
          });
        },
        [resolved.slug, devicePoints as Point[]] as const,
      );
    };

    const lastOf = (snapshots: readonly S[]): S =>
      snapshots[snapshots.length - 1] as S;

    const readSnapshot = async (): Promise<S> =>
      (await call("snapshot", [])) as S;

    const stepBy = async (count: number): Promise<S> => {
      const frames = Math.max(0, Math.floor(count));
      return lastOf((await drive(frames)).snapshots);
    };

    const skipBy = async (count: number): Promise<S> => {
      const frames = Math.max(0, Math.floor(count));
      if (frames === 0) return readSnapshot();
      return march(frames);
    };

    const lastCalls = async (): Promise<DrawCall[]> => {
      const ops = (await page.evaluate(
        (rec) =>
          (window as unknown as Record<string, { last(): unknown[] }>)[
            rec
          ]!.last(),
        resolved.recorderGlobal,
      )) as RecordedOp[];
      const calls = ops.map(toDrawCall);
      if (resolved.measureText) await measureTextCalls(page, calls);
      return calls;
    };

    const harness: Harness<S, D> = {
      page,
      config: resolved,
      debug,
      surfaceFault,
      openingSnapshot,
      openingScreen:
        openingSnapshot === null
          ? null
          : (((openingSnapshot as { screen?: unknown }).screen ?? null) as
              | string
              | null),
      pageErrors,
      cues: cueSinks,

      frame: () => frameCount,
      tick: () => frameCount,
      timeMs: () => timeMs,

      snapshot: () => readSnapshot(),

      // `advance` and `skip` answer nothing; `step` answers the state. All three
      // run the same frames — see the declarations above for why the pair is
      // split this way.
      advance: async (count = 1) => {
        await stepBy(count);
      },
      step: (count = 1) => stepBy(count),
      skip: async (count = 1) => {
        await skipBy(count);
      },

      // The seconds-denominated pair, which differ from each other in exactly
      // what `advance` and `skip` differ in: whether the recorder keeps it.
      advanceSeconds: (span, frames = 1) =>
        runSpan("advanceSeconds", span, frames, true),
      skipSeconds: (span, frames = 1) =>
        runSpan("skipSeconds", span, frames, false),

      until: (predicate, untilOptions = {}) =>
        sweep(readSnapshot, stepBy, predicate, untilOptions),
      stepUntil: (predicate, untilOptions = {}) =>
        sweep(readSnapshot, stepBy, predicate, untilOptions),
      skipUntil: (predicate, untilOptions = {}) =>
        sweep(readSnapshot, skipBy, predicate, untilOptions),

      /* ---- One crossing instead of N ------------------------------------ */

      async arrange(calls) {
        if (surfaceFault !== null) refuse();
        requireBatch(calls as readonly (readonly unknown[])[]);
        // No function is carried here, so this is an ordinary evaluation with
        // its arguments passed as values rather than a script assembled as
        // text: an arrangement has nothing of the suite's to carry into the page.
        const arranged = (await page.evaluate(
          ([handle, batch]) => {
            const api = (window as unknown as PageGlobals)[handle]!;
            for (const entry of batch) {
              const [name, ...args] = entry as [string, ...unknown[]];
              api[name]!(...args);
            }
            return api.snapshot!();
          },
          [resolved.handle, calls as readonly (readonly unknown[])[]] as const,
        )) as S;
        return project(arranged);
      },

      async sweep(predicate, argument, sweepOptions = {}) {
        if (surfaceFault !== null) refuse();
        const calls = (sweepOptions.arrange ??
          []) as readonly (readonly unknown[])[];
        requireBatch(calls);
        const max =
          sweepOptions.maxFrames ?? sweepOptions.maxTicks ?? DEFAULT_MAX_FRAMES;
        const bound = Math.max(0, max);
        const poll = Math.max(1, sweepOptions.poll ?? 1);
        // Every delta the sweep MIGHT run, drawn before the crossing opens
        // because the frames run inside it. What it does not use goes back
        // below, through `Clock.rewind`.
        const deltas: number[] = [];
        for (let i = 0; i < bound; i += 1) deltas.push(clock.delta());

        const script = `((predicate, batch, dts, poll, argument) => {
  ${preludeSource}
  const sounds = [];
  for (const entry of batch) api[entry[0]](...entry.slice(1));
  const arranged = api.snapshot();
  let snapshot = arranged;
  if (predicate(snapshot, argument, arranged) === true) {
    return { hit: true, frames: 0, snapshot: snapshot, arranged: arranged, sounds: sounds };
  }
  let frames = 0;
  while (frames < dts.length) {
    const stride = Math.min(poll, dts.length - frames);
    for (let i = 0; i < stride; i += 1) {
      const dt = dts[frames + i];${recordedFrameSource}
    }
    frames += stride;
    snapshot = api.snapshot();
    if (predicate(snapshot, argument, arranged) === true) {
      return { hit: true, frames: frames, snapshot: snapshot, arranged: arranged, sounds: sounds };
    }
  }
  return { hit: false, frames: frames, snapshot: snapshot, arranged: arranged, sounds: sounds };
})(${String(predicate)}, ${JSON.stringify(calls)}, ${JSON.stringify(
          deltas,
        )}, ${JSON.stringify(poll)}, ${JSON.stringify(argument)})`;

        const result = (await page.evaluate(script)) as {
          hit: boolean;
          frames: number;
          snapshot: S;
          arranged: S;
          sounds: number[];
        };

        // Only the frames that RAN are the harness's, and the deltas the sweep
        // asked for and did not use go back to the clock — see `Clock.rewind`.
        clock.rewind?.(deltas.length - result.frames);
        accountFrames(deltas, result.sounds, result.frames);
        return {
          ...swept(result.hit, result.frames, project(result.snapshot)),
          arranged: project(result.arranged),
        };
      },

      async samples(frames, sampleOptions) {
        if (surfaceFault !== null) refuse();
        const whole = Math.max(0, Math.floor(frames));
        const deltas: number[] = [];
        for (let i = 0; i < whole; i += 1) deltas.push(clock.delta());

        const script = `((project, stop, dts, argument) => {
  ${preludeSource}
  const sounds = [];
  const taken = [project(api.snapshot(), argument)];
  let frames = 0;
  const held = (sample) => stop !== null && stop(sample, taken, argument) === true;
  if (!held(taken[0])) {
    for (const dt of dts) {${recordedFrameSource}
      frames += 1;
      const sample = project(api.snapshot(), argument);
      taken.push(sample);
      if (held(sample)) break;
    }
  }
  return { samples: taken, frames: frames, snapshot: api.snapshot(), sounds: sounds };
})(${String(sampleOptions.project)}, ${
          sampleOptions.stop === undefined ? "null" : String(sampleOptions.stop)
        }, ${JSON.stringify(deltas)}, ${JSON.stringify(
          sampleOptions.argument,
        )})`;

        const result = (await page.evaluate(script)) as {
          samples: unknown[];
          frames: number;
          snapshot: S;
          sounds: number[];
        };

        clock.rewind?.(deltas.length - result.frames);
        accountFrames(deltas, result.sounds, result.frames);
        return {
          // The readings are the CHECK's own, taken in the page off states this
          // package never saw; only the state that crosses back out as `S` goes
          // through the case's narrowing.
          samples: result.samples as never[],
          snapshot: project(result.snapshot),
          frames: result.frames,
        };
      },

      async trials(rounds, trialOptions) {
        if (surfaceFault !== null) refuse();
        // `stage` builds its calls in the page, so the operations it may issue
        // cannot be read off a batch here — the case names them instead, and
        // they are checked before the crossing opens exactly as an `arrange` is.
        for (const operation of trialOptions.operations) {
          requireOperation(operation);
        }
        const whole = Math.max(0, Math.floor(rounds));
        const deltas: number[] = [];
        for (let i = 0; i < whole; i += 1) deltas.push(clock.delta());

        const script = `((stage, read, dts, argument) => {
  ${preludeSource}
  const sounds = [];
  const readings = [];
  let last = null;
  for (let round = 0; round < dts.length; round += 1) {
    for (const entry of stage(round, last, argument)) api[entry[0]](...entry.slice(1));
    const dt = dts[round];${recordedFrameSource}
    last = read(api.snapshot(), argument);
    readings.push(last);
  }
  return { readings: readings, snapshot: api.snapshot(), sounds: sounds };
})(${String(trialOptions.stage)}, ${String(
          trialOptions.read,
        )}, ${JSON.stringify(deltas)}, ${JSON.stringify(
          trialOptions.argument,
        )})`;

        const result = (await page.evaluate(script)) as {
          readings: unknown[];
          snapshot: S;
          sounds: number[];
        };

        // Every round ran a frame — a trial has no early stop — so nothing goes
        // back to the clock.
        accountFrames(deltas, result.sounds, deltas.length);
        return {
          readings: result.readings as never[],
          snapshot: project(result.snapshot),
        };
      },

      async stepWatching(count, watch) {
        const seen: S[] = [];
        for (let i = 0; i < count; i += 1) {
          const snapshot = lastOf((await drive(1)).snapshots);
          seen.push(snapshot);
          if (watch?.(snapshot, i + 1) === true) break;
        }
        return seen;
      },

      async runFor(ms) {
        if (surfaceFault !== null) refuse();
        // The one thing here that depends on real elapsed time, so the one thing
        // a browser's own idea of which page matters can distort. The launch
        // already turns the throttling off; bringing the page forward as well
        // means this does not rest on a flag alone.
        await page.bringToFront().catch(() => undefined);
        await page.evaluate(
          ([handle, rec]) => {
            (window as unknown as Record<string, { setMode(m: string): void }>)[
              rec
            ]!.setMode("raf");
            (
              window as unknown as Record<
                string,
                { setAutoStep(on: boolean): void }
              >
            )[handle]!.setAutoStep(true);
          },
          [resolved.handle, resolved.recorderGlobal] as const,
        );
        await page.waitForTimeout(ms);
        await page.evaluate(
          ([handle, rec]) => {
            (
              window as unknown as Record<
                string,
                { setAutoStep(on: boolean): void }
              >
            )[handle]!.setAutoStep(false);
            (window as unknown as Record<string, { setMode(m: string): void }>)[
              rec
            ]!.setMode("manual");
          },
          [resolved.handle, resolved.recorderGlobal] as const,
        );
      },

      async runUntil(predicate, runOptions = {}) {
        if (surfaceFault !== null) refuse();
        const timeoutMs = runOptions.timeoutMs ?? RUN_UNTIL_TIMEOUT_MS;
        const pollMs = Math.max(1, runOptions.pollMs ?? RUN_UNTIL_POLL_MS);
        // The one thing here that depends on real elapsed time, so the one thing
        // a browser's own idea of which page matters can distort. Chromium slows
        // the timers and all but stops the animation frame of a page it believes
        // nobody is looking at, and a project holds several pages open at once so
        // its suites can overlap — so a build running perfectly well would read
        // as one that froze. The launch already turns that throttling off
        // (`CHROMIUM_ARGS`); bringing the page forward as well means the one
        // measurement that cannot survive it does not rest on a flag alone.
        await page.bringToFront().catch(() => undefined);
        await page.evaluate(
          ([handle, rec]) => {
            (window as unknown as Record<string, { setMode(m: string): void }>)[
              rec
            ]!.setMode("raf");
            (
              window as unknown as Record<
                string,
                { setAutoStep(on: boolean): void }
              >
            )[handle]!.setAutoStep(true);
          },
          [resolved.handle, resolved.recorderGlobal] as const,
        );
        const started = Date.now();
        let snapshot = await readSnapshot();
        let hit = predicate(snapshot);
        while (!hit && Date.now() - started < timeoutMs) {
          await page.waitForTimeout(pollMs);
          // A reading only: `snapshot` poses nothing, so the loop under watch is
          // the only thing moving the game while this waits.
          snapshot = await readSnapshot();
          hit = predicate(snapshot);
        }
        const elapsedMs = Date.now() - started;
        await page.evaluate(
          ([handle, rec]) => {
            (
              window as unknown as Record<
                string,
                { setAutoStep(on: boolean): void }
              >
            )[handle]!.setAutoStep(false);
            (window as unknown as Record<string, { setMode(m: string): void }>)[
              rec
            ]!.setMode("manual");
          },
          [resolved.handle, resolved.recorderGlobal] as const,
        );
        // The loop is handed back whatever the answer, INCLUDING when the
        // predicate never held: a watch that gave up still leaves the harness the
        // way it found it, so the check that follows drives frames rather than
        // racing the build's own loop, and the failure is reported by the caller
        // reading `hit` rather than by everything after it behaving strangely.
        return { hit, snapshot, elapsedMs };
      },

      hold: (code) => page.keyboard.down(code),
      release: (code) => page.keyboard.up(code),

      async tap(code) {
        // Down, ONE frame, up. The frame between the two is what makes this a
        // press a build can actually see: an engineless build wrote its own
        // keyboard layer, and the two conformant ways to read a press — latching
        // the edge in the event handler, or comparing held state at the top of
        // each frame — agree only if the key is genuinely held while a frame
        // runs. A down and an up delivered back to back would be invisible to the
        // second, which is a build a real player has no trouble with.
        await page.keyboard.down(code);
        const snapshot = await stepBy(1);
        await page.keyboard.up(code);
        return snapshot;
      },

      async holdFor(code, count) {
        await page.keyboard.down(code);
        try {
          return await stepBy(count);
        } finally {
          await page.keyboard.up(code);
        }
      },

      async movePointer(x, y) {
        const at = cssPointOf(x, y);
        await page.mouse.move(at.x, at.y);
      },

      async clickPointer(x, y, button = "left") {
        const at = cssPointOf(x, y);
        await page.mouse.move(at.x, at.y);
        await page.mouse.down({ button });
        const snapshot = await stepBy(1);
        await page.mouse.up({ button });
        return snapshot;
      },

      async frameCalls() {
        await drive(1);
        return lastCalls();
      },

      lastCalls: () => lastCalls(),

      probe: (names) =>
        page.evaluate(
          ([handle, wanted]) => {
            const target =
              (window as unknown as Record<string, Record<string, unknown>>)[
                handle
              ] ?? {};
            const ops: Record<string, string> = {};
            for (const name of wanted) ops[name] = typeof target[name];
            return { version: target.version, ops };
          },
          [resolved.handle, [...names]] as const,
        ),

      viewport: () => ({ ...view }),
      device: (x, y) => toDevice(view, x, y),
      css: (x, y) => {
        const at = toDevice(view, x, y);
        return { x: at.x / dpr, y: at.y / dpr };
      },
      cssPoint: (x, y) => cssPointOf(x, y),
      pixel: async (x, y) =>
        (await readPixels([toDevice(view, x, y)]))[0] as Pixel,
      pixels: (points) =>
        readPixels(points.map((p) => toDevice(view, p.x, p.y))),
      devicePixel: async (x, y) => (await readPixels([{ x, y }]))[0] as Pixel,

      async pixelRect(x, y, width, height) {
        await settle();
        const origin = toDevice(view, x, y);
        const deviceW = Math.max(1, Math.round(width * view.scale));
        const deviceH = Math.max(1, Math.round(height * view.scale));
        const encoded = (await page.evaluate(
          ([slug, left, top, wide, high]) => {
            const canvases = Array.from(document.querySelectorAll("canvas"));
            const first = canvases[0];
            if (first === undefined)
              throw new Error(`${slug}: the page has no <canvas>`);
            let canvas = first;
            for (const other of canvases) {
              if (other.width * other.height > canvas.width * canvas.height)
                canvas = other;
            }
            const ctx = canvas.getContext("2d");
            if (ctx === null)
              throw new Error(`${slug}: the canvas has no 2D context`);
            const clampedX = Math.min(Math.max(left, 0), canvas.width);
            const clampedY = Math.min(Math.max(top, 0), canvas.height);
            const clampedW = Math.max(
              1,
              Math.min(wide, canvas.width - clampedX),
            );
            const clampedH = Math.max(
              1,
              Math.min(high, canvas.height - clampedY),
            );
            const pixels = ctx.getImageData(
              clampedX,
              clampedY,
              clampedW,
              clampedH,
            );
            // Base64 rather than an array of numbers: see `PixelRect`. The
            // string is built in chunks because `String.fromCharCode` is applied
            // to its arguments, and two million of them overflow the stack.
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < pixels.data.length; i += chunk) {
              binary += String.fromCharCode(
                ...pixels.data.subarray(i, i + chunk),
              );
            }
            return {
              width: pixels.width,
              height: pixels.height,
              b64: btoa(binary),
            };
          },
          [resolved.slug, origin.x, origin.y, deviceW, deviceH] as const,
        )) as EncodedRect;
        return decodeRect(encoded);
      },

      async scanDevice(axis, index) {
        await settle();
        return page.evaluate(
          ([slug, which, at]) => {
            const canvases = Array.from(document.querySelectorAll("canvas"));
            const first = canvases[0];
            if (first === undefined) {
              throw new Error(`${slug}: the page has no <canvas>`);
            }
            let canvas = first;
            for (const other of canvases) {
              if (other.width * other.height > canvas.width * canvas.height) {
                canvas = other;
              }
            }
            const ctx2d = canvas.getContext("2d");
            if (ctx2d === null) {
              throw new Error(`${slug}: the canvas has no 2D context`);
            }
            const row = which === "row";
            const line = Math.min(
              Math.max(at, 0),
              Math.max((row ? canvas.height : canvas.width) - 1, 0),
            );
            const { data } = row
              ? ctx2d.getImageData(0, line, canvas.width, 1)
              : ctx2d.getImageData(line, 0, 1, canvas.height);
            const out: number[] = [];
            for (let i = 0; i < data.length; i += 4) {
              out.push(
                ((data[i] as number) +
                  (data[i + 1] as number) +
                  (data[i + 2] as number)) /
                  3,
              );
            }
            return out;
          },
          [resolved.slug, axis, index] as const,
        );
      },

      async imagePixels(id) {
        const read = (await page.evaluate(
          ([rec, wanted]) =>
            (
              window as unknown as Record<
                string,
                {
                  imagePixels(
                    n: number,
                  ): { width: number; height: number; data: number[] } | null;
                }
              >
            )[rec]!.imagePixels(wanted),
          [resolved.recorderGlobal, id] as const,
        )) as { width: number; height: number; data: number[] } | null;
        if (read === null) return null;
        // A sprite is small enough that the array costs nothing; it is widened to
        // the same shape a canvas read has, so the two are interchangeable.
        return {
          width: read.width,
          height: read.height,
          data: Uint8ClampedArray.from(read.data),
        };
      },

      surface: () =>
        page.evaluate((slug) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          const first = canvases[0];
          if (first === undefined) {
            throw new Error(
              `${slug}: the page has no <canvas>, so the build drew nowhere — ` +
                "index.html supplies one and the build is asked not to edit it " +
                "(specs/overview.md)",
            );
          }
          let canvas = first;
          for (const other of canvases) {
            if (other.width * other.height > canvas.width * canvas.height)
              canvas = other;
          }
          return {
            width: canvas.width,
            height: canvas.height,
            dpr: window.devicePixelRatio,
          };
        }, resolved.slug),

      // The gesture, and nothing else. It reaches the page as a real browser
      // event rather than through the surface, so it is not refused on a surface
      // fault: a build that installed no surface can still be handed a press,
      // and the check that reads what it SOUNDED fails on its own reading rather
      // than on the arming.
      armAudio: () => armGesture(),

      sounds: () =>
        page.evaluate(
          (audioName) =>
            (window as unknown as Record<string, { started(): number }>)[
              audioName
            ]!.started(),
          resolved.audioGlobal,
        ),

      loopingSounds: () =>
        page.evaluate(
          (audioName) =>
            (window as unknown as Record<string, { looping(): number }>)[
              audioName
            ]!.looping(),
          resolved.audioGlobal,
        ),

      loopStarts: () =>
        page.evaluate(
          (audioName) =>
            (window as unknown as Record<string, { loopStarts(): number }>)[
              audioName
            ]!.loopStarts(),
          resolved.audioGlobal,
        ),

      async dispose() {
        // The context stays: it holds the init scripts and the window shape, and
        // the next harness of this shape wants both. The page goes, so nothing
        // this check pressed, opened or muted can reach the next one.
        openPages.delete(page);
        await page.close().catch(() => undefined);
      },
    };

    harnessCues.set(harness, cueSinks);
    return harness;
  };
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. A case's specification
 * requires one cue per event, played from the update on the frame its event
 * happens, and says nothing at all about how a build makes a sound — under no
 * engine the whole audio layer is the build's. So the injected audio probe
 * watches the two doors a browser can emit sound through (a Web Audio source
 * being `start()`ed, whatever kind it is, and an `<audio>` element being played)
 * and counts what goes through them; the harness brackets each driven frame
 * around that count, so a sound is attributed to the frame that produced it. A
 * blip made of two oscillators counts as two, which is why a check asserts that a
 * frame sounded rather than how many times: the number of sources is the build's
 * business and the specification never fixed it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for a cue by name and the bus announces it. There is no bus
 * here to ask, so these checks confirm that a sound was emitted and on which
 * frame, and a reviewer decides by ear whether the cues are told apart. That is a
 * real reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to use — would grade builds against an implementation rather
 * than against the specification.
 *
 * THIS LIVES BESIDE `createHarnessFactory` BY DESIGN. The sinks it attaches to
 * are the very arrays the drive pushes into; split across a module boundary the
 * two type-check perfectly and this returns an array that never fills, so every
 * audio check passes vacuously.
 */
export function watchCues<S, D>(h: Harness<S, D>): TimedCue[] {
  const played: TimedCue[] = [];
  const sinks = harnessCues.get(h) ?? h.cues;
  sinks.push(played);
  return played;
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                   */
/* -------------------------------------------------------------------------- */
//
// WHAT A CAPTURE IS, AND WHAT IT IS NOT.
//
// 1. IT IS A REVIEW OUTPUT. The runner collects what lands under the media
//    directory and addresses it by the staged path of the suite that produced it.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before
//    the failure travels on — a failing check is the one whose replay a reviewer
//    most wants. A recording that cannot be written is reported as an output that
//    never turned up, which is a fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/**
 * Write a recording out, reporting rather than raising anything that goes wrong.
 *
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the run would tell the
 * reviewer there is a replay to watch and then open the player on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers and repeated field names, which gzip takes down to a
 * fraction of its size, and every host that serves one declares the encoding so
 * the browser inflates it before the player sees it. The document inside is the
 * same one.
 *
 * Never throws. A file that cannot be written says something about the machine
 * the validators ran on, and failing the point over it would blame the build for
 * the host's problem.
 */
function writeReplay(
  slug: string,
  destination: string,
  recording: Recording | null,
): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`${slug}: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "retract", () => unwind(h));
 * assertEqual(swept.cells.length, 1);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export async function captureReplay<S, D, T>(
  h: Harness<S, D>,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const { config } = h;
  const destination = mediaDestination(config.projectRoot, outputId, "json.gz");
  if (destination === null) return scenario();

  const view = h.viewport();
  await h.page.evaluate(
    ([rec, design]) =>
      (window as unknown as Record<string, { arm(d: unknown): boolean }>)[
        rec
      ]!.arm(design),
    [
      config.recorderGlobal,
      {
        width: view.width,
        height: view.height,
        background: config.replayBackground,
      },
    ] as const,
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(
      (rec) =>
        (window as unknown as Record<string, { disarm(): unknown }>)[
          rec
        ]!.disarm(),
      config.recorderGlobal,
    )) as Recording | null;
    writeReplay(config.slug, destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the posed board, the select grid, the
 * screen a menu landed on. What is written is whatever the last frame that RAN
 * left behind, so drive a frame after the pose and call this before the
 * assertions, so a check that fails still leaves the picture that shows why.
 * Nothing here can change a verdict: outside a run this is a no-op, and a still
 * that cannot be written is reported as an output that never turned up.
 */
export async function captureStill<S, D>(
  h: Harness<S, D>,
  outputId: string,
): Promise<void> {
  const { config } = h;
  const destination = mediaDestination(config.projectRoot, outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    await h.page.screenshot({ path: destination, type: "png" });
  } catch (error) {
    console.warn(
      `${config.slug}: could not write ${destination}: ${String(error)}`,
    );
  }
}
