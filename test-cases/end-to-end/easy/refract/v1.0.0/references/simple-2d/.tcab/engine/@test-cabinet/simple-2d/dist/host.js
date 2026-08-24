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
import { validateSchedule } from "./schedule";
/**
 * The `window` property the interface is installed on.
 *
 * It matches the `handle` field of `engines/simple-2d/engine.toml`; the two are one
 * contract, and a driver looks the handle up from the engine catalogue rather than
 * hard-coding it.
 */
export const HOST_HANDLE = "__tcabEngine";
/**
 * The interface's version, bumped whenever an operation's shape or meaning changes.
 *
 * A driver reads it first and can then say "this build predates the operation I
 * need" instead of calling a missing function and reporting a broken build.
 */
export const HOST_VERSION = 1;
/** The two clocks, as a runtime set — the type alone cannot police untyped JSON. */
const CLOCK_MODES = ["auto", "manual"];
/**
 * Reduce a value produced by game code to something that survives the trip to a
 * driver.
 *
 * A diagnostic source may return anything: a function, a DOM node, an object that
 * refers back to itself. Any of those makes the *whole* `page.evaluate` fail, so a
 * single careless source would take away every other diagnostic at once. A
 * JSON round-trip keeps the values that are already plain exactly as they are and
 * degrades the rest to their string form, which is still far more use to a reader
 * than a failed read.
 */
function plain(value) {
    try {
        const encoded = JSON.stringify(value);
        // `undefined`, a function and a symbol all encode to `undefined`; `null` is the
        // JSON-shaped way to say "there was a value here and it was not representable".
        return encoded === undefined ? null : JSON.parse(encoded);
    }
    catch {
        return String(value);
    }
}
/** Reject a clock mode a driver invented, before it can silently stall the loop. */
function requireClockMode(mode) {
    if (!CLOCK_MODES.includes(mode)) {
        throw new Error(`unknown clock mode ${JSON.stringify(mode)}; expected "auto" or "manual"`);
    }
    return mode;
}
/**
 * Reject a magnitude that is not a number.
 *
 * `NaN` is the dangerous one: it compares unequal to zero, so a digital action
 * would read as held forever and an analog one would poison every quantity the
 * game multiplies by it, several frames away from the call that caused it.
 */
function requireFinite(name, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`setAction("${name}") needs a finite number, got ${JSON.stringify(value)}`);
    }
    return value;
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
export function installHost(ports) {
    const host = {
        version: HOST_VERSION,
        setClock: (mode) => ports.frame.setClock(requireClockMode(mode)),
        setSchedule: (schedule) => {
            // Validated here rather than in the loop because this is where a schedule
            // crosses from untyped JSON into the engine, and the messages
            // `validateSchedule` produces name the field and the value that is wrong.
            validateSchedule(schedule);
            ports.frame.setSchedule(schedule);
        },
        advance: (steps) => ports.frame.advance(steps),
        frame: () => ports.frame.info(),
        actions: () => ports.input.actions(),
        setAction: (name, value) => ports.input.setAction(name, requireFinite(name, value)),
        pressAction: (name) => ports.input.pressAction(name),
        layout: () => ports.input.layout(),
        audioLog: () => ports.audio.log(),
        audioState: () => ports.audio.state(),
        assetLog: () => ports.assets.log(),
        diagnostics: () => {
            const values = {};
            for (const [name, value] of Object.entries(ports.diagnostics.read())) {
                values[name] = plain(value);
            }
            return values;
        },
        setOverlay: (enabled) => ports.diagnostics.setEnabled(Boolean(enabled)),
    };
    ports.target[HOST_HANDLE] = host;
    return () => {
        if (ports.target[HOST_HANDLE] === host)
            delete ports.target[HOST_HANDLE];
    };
}
//# sourceMappingURL=host.js.map