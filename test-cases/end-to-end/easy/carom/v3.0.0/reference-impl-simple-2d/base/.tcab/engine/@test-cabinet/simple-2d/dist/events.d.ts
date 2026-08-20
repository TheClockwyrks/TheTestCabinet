import type { EngineEventMap, EngineEvents } from "./contract";
/** What a handler for `event` is called with. */
type Handler<K extends keyof EngineEventMap> = (payload: EngineEventMap[K]) => void;
/**
 * The broadcaster behind `engine.events` and the `events` facade on `InitApi`.
 *
 * The public half is {@link EventBus.on}, which is all {@link EngineEvents}
 * declares and all a game or a validator is handed. {@link EventBus.emit} and
 * {@link EventBus.clear} are the internal half: subsystems emit, and the engine
 * clears on `destroy()`. A caller holding the bus as an `EngineEvents` cannot
 * reach either, which is what stops a game from broadcasting engine events of its
 * own invention.
 */
export declare class EventBus implements EngineEvents {
    /**
     * Subscribers by event name, in subscription order.
     *
     * An array rather than a `Set` for two reasons: order is part of the contract,
     * and subscribing the same function twice is a legitimate thing for two
     * independent observers sharing a helper to do — each of their unsubscribes
     * should then remove one of the two, which set semantics cannot express.
     */
    private readonly bins;
    /**
     * Subscribe to `event`, and return the function that removes the handler.
     *
     * The returned function is idempotent: calling it a second time does nothing.
     * That matters because unsubscribing is normally a teardown step, and teardown
     * runs twice more often than anyone intends — from an `afterEach` and from a
     * `finally`, or from an abort and from a `destroy`. Were it not idempotent, the
     * second call would find the slot reoccupied by whatever subscribed after it and
     * silently unsubscribe a stranger.
     */
    on<K extends keyof EngineEventMap>(event: K, handler: Handler<K>): () => void;
    /**
     * Broadcast `payload` to every handler subscribed to `event`, in subscription
     * order, before returning.
     *
     * Dispatch walks a *snapshot* of the bin. A handler is free to subscribe or
     * unsubscribe — its own subscription included — without disturbing the dispatch
     * already in progress: a handler added during it does not receive this event, and
     * one removed during it still does. The alternative, walking the live array, makes
     * the set of handlers that observe a single event depend on the order they
     * happened to be registered in, which is the kind of thing that works in a test
     * and not in the build.
     *
     * A nested emit is fine for the same reason. A handler that emits gets its own
     * snapshot, and the inner dispatch completes before the outer one resumes.
     */
    emit<K extends keyof EngineEventMap>(event: K, payload: EngineEventMap[K]): void;
    /**
     * Drop every subscription.
     *
     * `engine.destroy()` calls this. A handler typically closes over the caller's own
     * scene or test fixture, so leaving the bus subscribed after teardown keeps that
     * scope alive and lets a stale handler observe a successor engine's events.
     */
    clear(): void;
}
export {};
//# sourceMappingURL=events.d.ts.map