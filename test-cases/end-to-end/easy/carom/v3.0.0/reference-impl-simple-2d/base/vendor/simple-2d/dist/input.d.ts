/**
 * The action registry: the engine's single answer to "is the player doing X?".
 *
 * A game never reads `KeyboardEvent`s. It registers *named actions* with the keys
 * that drive them and then asks the registry for a value or an edge. Three things
 * fall out of that indirection, and they are the reason it exists:
 *
 * - The same action can be driven from anywhere — a key, a touch layout, or a
 *   driver calling {@link InputRegistry.setAction} — and the game cannot tell which,
 *   so a build is checkable without synthesizing input events at all.
 * - The bindings become *data*. {@link InputRegistry.actions} is a static read that
 *   answers "did this build register and bind everything it was asked to" with no
 *   keystrokes and no gameplay.
 * - Edge detection lives in one place, correctly, instead of in every game.
 *
 * The registry owns no timing of its own: the frame loop calls
 * {@link InputRegistry.endFrame} once per frame, which is what makes "pressed since
 * the last frame" meaningful.
 */
import type { ActionBinding, RegisteredAction, TouchLayout } from "./contract";
export declare class InputRegistry {
    #private;
    /**
     * Attaches to `target` immediately — the registry is live before any action is
     * registered, so a key held down during start-up is already accounted for by the
     * time the game binds it… and, more usefully, so the game never has to remember
     * to start listening.
     */
    constructor(target: EventTarget);
    /**
     * Registers (or re-registers) `name`.
     *
     * Re-registering replaces the binding wholesale and resets the action to rest.
     * Carrying held state across a rebind would strand an action on: the code that
     * was down is no longer one of its keys, so no keyup could ever lower it again.
     * The action keeps its position in {@link actions} so the reported order stays
     * stable across a rebind.
     *
     * An unfamiliar `name` is not an error. A game may name actions the engine has
     * never heard of, and that is the normal case for anything beyond a layout's
     * vocabulary.
     */
    register(name: string, binding: ActionBinding): void;
    /**
     * Selects the touch layout, which from here on tags any registration of one of
     * its vocabulary actions.
     *
     * @throws if the layout is not in the catalogue — see {@link touchLayout}.
     */
    useLayout(name: string): void;
    /** The selected layout and its vocabulary, or `null` if none was selected. */
    layout(): TouchLayout | null;
    /**
     * Every registered action with its defaults resolved, in registration order.
     *
     * Copied out rather than exposed: this crosses the `window` boundary into a
     * driver, and handing out the live state would let a reader mutate the bindings.
     */
    actions(): RegisteredAction[];
    /**
     * The action's current magnitude: `1` while a bound key is down, otherwise
     * whatever a driver last set. A digital action is quantized to `0` or `1` — the
     * kind is a promise about what the game will read, so a driver pushing `0.5` at a
     * digital action gets "held", not a half-press the game is not written for.
     *
     * An unregistered name reads `0` instead of throwing, because a driver probing
     * for an action a build was supposed to register must be able to discover that it
     * is missing without taking the page down.
     */
    value(name: string): number;
    /**
     * Whether the action was pressed since the last frame — true exactly once per
     * edge, then consumed.
     *
     * Consumption on read is what makes this safe to poll from more than one place:
     * a menu and the gameplay layer both asking "was confirm pressed" in the same
     * frame must not both act on one press.
     */
    pressed(name: string): boolean;
    /**
     * Drives the action directly, as the host interface does for a driver.
     *
     * This takes the same path a key does, so crossing from rest into motion arms the
     * edge exactly as a keypress would — a driver that sets an action and then checks
     * `pressed` sees what the player would have caused.
     */
    setAction(name: string, value: number): void;
    /**
     * Arms the action's edge without touching its held value — a tap.
     *
     * Deliberately not "set to 1": a driver has no release to send afterwards, so a
     * press that also raised the value would leave the action stuck on for the rest
     * of the run.
     */
    pressAction(name: string): void;
    /**
     * Discards every edge that was not consumed this frame.
     *
     * Without this an edge armed during a frame the game did not poll would surface
     * later, out of order with the input that caused it. A press is news for one
     * frame only.
     */
    endFrame(): void;
    /**
     * Detaches the key listeners. Idempotent, because teardown races — a page unload
     * and an explicit `stop()` may both reach here.
     */
    detach(): void;
}
