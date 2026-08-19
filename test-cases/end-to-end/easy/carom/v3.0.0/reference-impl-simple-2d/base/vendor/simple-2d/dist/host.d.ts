/**
 * The host interface: the seam a driver binds to in order to *operate* a build
 * rather than play it.
 *
 * This lives in the engine, not in the game, and that is the entire point. An
 * instrumentation surface the build exposes is one the build can omit, misname, or
 * implement subtly differently, so a validation script driving it has to be written
 * defensively around all three. Here the operations are engine code: calling
 * {@link createEngine} installs them, so a build that runs at all is a build that is
 * driveable, and the contract is the same for every case that selects the engine.
 *
 * Two invariants shape everything below:
 *
 * - **Everything returned is plain data.** A driver reads these values out of
 *   `page.evaluate`, which structured-clones across the browser boundary: a class
 *   instance, a live internal array, a function or a cyclic object either arrives
 *   mangled or throws and takes the whole read with it. Each port already hands back
 *   copies; {@link plain} covers the one place the values originate in *game* code
 *   and can therefore be anything at all.
 * - **This is the untrusted boundary.** Arguments arrive as JSON from outside the
 *   type system, so `setClock("fast")` or a jitter schedule with `maxMs < minMs` are
 *   things that actually happen. They are rejected here, with the offending value in
 *   the message, because the alternative failure — a page whose clock is neither
 *   `"auto"` nor `"manual"` and therefore never runs another frame — looks like a
 *   hung build rather than a bad call.
 *
 * The module depends on nothing but {@link ./contract} and the pure schedule
 * validator, so `@test-cabinet/simple-2d/host` can be imported for its types alone —
 * by a validation script or a driver — without dragging in the DOM-bound engine.
 */
import type { AssetEvent, AudioState, ClockMode, CueEvent, FrameInfo, RegisteredAction, Schedule, TouchLayout } from "./contract";
/**
 * The `window` property the interface is installed on.
 *
 * It matches the `handle` field of `engines/simple-2d/engine.toml`; the two are one
 * contract, and a driver looks the handle up from the engine catalogue rather than
 * hard-coding it.
 */
export declare const HOST_HANDLE = "__tcabEngine";
/**
 * The interface's version, bumped whenever an operation's shape or meaning changes.
 *
 * A driver reads it first and can then say "this build predates the operation I
 * need" instead of calling a missing function and reporting a broken build.
 */
export declare const HOST_VERSION = 1;
/** The operations a driver may perform on a running engine. */
export interface EngineHost {
    /** {@link HOST_VERSION} at the time the page was built. */
    version: number;
    /** Hand the frame clock to the driver (`"manual"`) or back to the wall clock. */
    setClock(mode: ClockMode): void;
    /** Install the delta pattern the manual clock steps on. */
    setSchedule(schedule: Schedule): void;
    /** Run exactly `steps` frames off the current schedule, synchronously. */
    advance(steps: number): void;
    /** The frame counter, simulated time, and the most recent step. */
    frame(): FrameInfo;
    /** Every action the build registered, with its bindings and provenance. */
    actions(): RegisteredAction[];
    /** Drive an action's magnitude directly, as a held key or a touch slider would. */
    setAction(name: string, value: number): void;
    /** Arm an action's edge — a tap, with no release to send afterwards. */
    pressAction(name: string): void;
    /** The selected touch layout and its vocabulary, or `null` if none was selected. */
    layout(): TouchLayout | null;
    /** Every cue the build has played, oldest first. */
    audioLog(): CueEvent[];
    /** Whether the bus is muted, and whether a gesture has unlocked it. */
    audioState(): AudioState;
    /** Every asset the build has requested, and whether each one arrived. */
    assetLog(): AssetEvent[];
    /** The build's registered diagnostic sources, evaluated now. */
    diagnostics(): Record<string, unknown>;
    /** Show or hide the debug overlay without touching the toggle key. */
    setOverlay(enabled: boolean): void;
}
/** The frame loop, as the host needs it. */
export interface FramePort {
    setClock(mode: ClockMode): void;
    setSchedule(schedule: Schedule): void;
    advance(steps: number): void;
    info(): FrameInfo;
}
/** The action registry, as the host needs it. */
export interface InputPort {
    actions(): RegisteredAction[];
    setAction(name: string, value: number): void;
    pressAction(name: string): void;
    layout(): TouchLayout | null;
}
/** The audio bus, as the host needs it. */
export interface AudioPort {
    log(): CueEvent[];
    state(): AudioState;
}
/** The asset loader, as the host needs it. */
export interface AssetPort {
    log(): AssetEvent[];
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
 * its types alone) and makes the host's real surface area readable: everything a
 * driver can reach is one of the methods listed above, and nothing else.
 */
export interface HostPorts {
    /** The object the handle is written to — the game's `window` in a browser. */
    target: Record<string, unknown>;
    frame: FramePort;
    input: InputPort;
    audio: AudioPort;
    assets: AssetPort;
    diagnostics: DiagnosticsPort;
}
/**
 * Install the host interface on `ports.target` and return the function that removes
 * it again.
 *
 * Installing over an existing handle **replaces** it rather than throwing. A page
 * that tears its engine down and builds another one — a level transition, a hot
 * reload, a test — must end up driveable by the engine that is actually running,
 * and a thrown error there would leave the page owned by a dead engine.
 *
 * The returned uninstaller removes the handle only while it is still *this* host's.
 * Destroying a superseded engine must not unpublish its replacement, which is the
 * exact order teardown tends to happen in: the new engine is created first, the old
 * one is disposed of afterwards.
 */
export declare function installHost(ports: HostPorts): () => void;
