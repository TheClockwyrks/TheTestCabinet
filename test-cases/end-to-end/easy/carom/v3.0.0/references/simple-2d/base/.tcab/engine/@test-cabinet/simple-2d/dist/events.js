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
export class EventBus {
    /**
     * Subscribers by event name, in subscription order.
     *
     * An array rather than a `Set` for two reasons: order is part of the contract,
     * and subscribing the same function twice is a legitimate thing for two
     * independent observers sharing a helper to do — each of their unsubscribes
     * should then remove one of the two, which set semantics cannot express.
     */
    bins = new Map();
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
    on(event, handler) {
        const bin = this.bins.get(event);
        if (bin) {
            bin.push(handler);
        }
        else {
            this.bins.set(event, [handler]);
        }
        let removed = false;
        return () => {
            if (removed)
                return;
            removed = true;
            const current = this.bins.get(event);
            if (!current)
                return;
            // By identity, and only the first match, so a duplicate subscription of the
            // same function survives its sibling's removal.
            const at = current.indexOf(handler);
            if (at !== -1)
                current.splice(at, 1);
            // Drop the empty bin so the map's size tracks live subscriptions rather than
            // the set of events that have ever had one.
            if (current.length === 0)
                this.bins.delete(event);
        };
    }
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
    emit(event, payload) {
        const bin = this.bins.get(event);
        if (!bin || bin.length === 0)
            return;
        // Sound because the bins are keyed by event name: everything in this bin was
        // registered through `on` for this same `K`.
        const snapshot = bin.slice();
        for (const handler of snapshot) {
            try {
                handler(payload);
            }
            catch (error) {
                // Per handler, so one throwing subscriber does not cost the rest of them
                // the event, and reported rather than swallowed — a subscriber's bug is
                // still a bug, it just is not the emitting subsystem's problem.
                console.error(`simple-2d: an "${event}" handler threw`, error);
            }
        }
    }
    /**
     * Drop every subscription.
     *
     * `engine.destroy()` calls this. A handler typically closes over the caller's own
     * scene or test fixture, so leaving the bus subscribed after teardown keeps that
     * scope alive and lets a stale handler observe a successor engine's events.
     */
    clear() {
        this.bins.clear();
    }
}
//# sourceMappingURL=events.js.map