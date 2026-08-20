/**
 * The host interface: the handle a built page publishes on its own window so that
 * the build can be *observed* from outside the process that runs it.
 *
 * This is deliberately not the seam a check drives a game through. A test case's
 * validators run in process — they import the engine and the game, construct the
 * engine with their own clock, and step it with `engine.advance` — so they already
 * hold the state, the events and the drawing context as live values. Anything this
 * module offered them would be a second, weaker copy of a surface they have
 * directly, and keeping such a surface published on `window` would mean the engine
 * carried operations whose only caller was a boundary nobody crosses any more.
 *
 * What is left is the pair of jobs that genuinely need an out-of-process handle:
 *
 * - **A post-run check confirming a build booted.** The handle appears at
 *   construction, before any game code runs, while {@link EngineHost.frame} still
 *   reports zero. A reader that finds the handle and then sees the counter advance
 *   between two reads has established that the page loaded, wired its canvas,
 *   resolved initialization and reached the frame loop — which no static inspection
 *   of the built files can show.
 * - **A person inspecting a running build.** Opening the page and typing the handle
 *   into a devtools console reads the same diagnostics the overlay draws, and
 *   {@link EngineHost.setOverlay} shows the panel without hunting for the toggle
 *   key.
 *
 * One invariant shapes what may be returned: **everything is plain data**. These
 * values are read through a page evaluation, which structured-clones across the
 * browser boundary, and a function, a DOM node or a cyclic object either arrives
 * mangled or throws and takes the whole read with it. The frame port already hands
 * back a copy of plain numbers; {@link plain} covers the one place values originate
 * in *game* code and can therefore be anything at all.
 *
 * The module depends on nothing but {@link ./contract}, so
 * `@test-cabinet/simple-2d/host` can be imported for its types alone — by a check
 * that only wants to know what shape the handle has — without dragging in the
 * DOM-bound engine.
 */
import type { FrameInfo } from "./contract";
/**
 * The `window` property the interface is installed on.
 *
 * It matches the `handle` field of `engines/simple-2d/engine.toml`; the two are one
 * contract, and a reader looks the handle up from the engine catalogue rather than
 * hard-coding it.
 */
export declare const HOST_HANDLE = "__tcabEngine";
/**
 * The interface's version, bumped whenever a member's shape or meaning changes.
 *
 * A reader takes it first and can then say "this build predates the member I want"
 * instead of calling a missing function and reporting a broken build. Version 2
 * dropped the driving operations — the clock, the schedule, the stepper, the action
 * setters and the accumulating logs — when validators moved in process, so a
 * version 1 handle and a version 2 handle agree on nothing but `frame`.
 */
export declare const HOST_VERSION = 1;
/** The read-mostly view of a running engine that a build publishes. */
export interface EngineHost {
    /** {@link HOST_VERSION} at the time the page was built. */
    version: number;
    /** The frame counter, simulated time, and the most recent step. */
    frame(): FrameInfo;
    /** The build's registered diagnostic sources, evaluated at the moment of the call. */
    diagnostics(): Record<string, unknown>;
    /** Show or hide the debug overlay without touching the toggle key. */
    setOverlay(enabled: boolean): void;
}
/** The frame loop, as the host needs it. */
export interface FramePort {
    info(): FrameInfo;
}
/** The diagnostics registry, as the host needs it. */
export interface DiagnosticsPort {
    read(): Record<string, unknown>;
    setEnabled(enabled: boolean): void;
}
/**
 * The parts {@link installHost} draws on.
 *
 * They are declared structurally, as the narrow slice of each subsystem the host
 * actually calls, rather than as the concrete classes. That keeps this module free
 * of the engine's implementation (so the `./host` entry point stays importable for
 * its types alone) and makes the host's real surface area readable: everything the
 * published handle can reach is one of the two ports below, and nothing else.
 */
export interface HostPorts {
    /** The object the handle is written to — the game's `window` in a browser. */
    target: Record<string, unknown>;
    frame: FramePort;
    diagnostics: DiagnosticsPort;
}
/**
 * Install the host interface on `ports.target` and return the function that removes
 * it again.
 *
 * Installing over an existing handle **replaces** it rather than throwing. A page
 * that tears its engine down and builds another one — a level transition, a hot
 * reload, a test — must end up publishing the engine that is actually running, and
 * a thrown error there would leave the page owned by a dead engine.
 *
 * The returned uninstaller removes the handle only while it is still *this* host's.
 * Destroying a superseded engine must not unpublish its replacement, which is the
 * exact order teardown tends to happen in: the new engine is created first, the old
 * one is disposed of afterwards.
 */
export declare function installHost(ports: HostPorts): () => void;
//# sourceMappingURL=host.d.ts.map