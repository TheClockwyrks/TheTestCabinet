// The deferred wait that follows a cancellation: the record a canceled run leaves
// behind does not exist when the cancel returns, so every refresh fired at that
// moment is premature.
//
// Kept in its own module, with no React and no context, because both the
// single-run kill and the runs section's bulk sweeps need it and because the
// decision it encodes — how long to wait, how to back off, and what to do when
// the budget runs out — is worth pinning down directly.

// How long to watch a canceled run for the record its driver hands back, and the
// poll interval, which backs off so a long wait costs a handful of requests
// rather than one a second for the whole budget.
//
// The budget is generous because the work behind it is unbounded in principle: a
// gg run carries the largest event streams and produced trees in the cabinet, and
// draining and uploading one is not a fixed cost. It is NOT what makes the run
// deletable, though — `useRunDeletion` answers that from the run's own publish
// state — so an expired wait costs promptness in the run list, never a control
// the operator needed.
const CANCELED_RECORD_WAIT_MS = 300_000;
const CANCELED_RECORD_POLL_MIN_MS = 1_000;
const CANCELED_RECORD_POLL_MAX_MS = 15_000;
const CANCELED_RECORD_POLL_GROWTH = 1.5;

/** Just the read this watcher needs, so the console's full worker client is not
 * part of its contract (and a test can hand it two lines). */
interface RunReader {
  getRun(runId: string): Promise<{ record: unknown | null }>;
}

/**
 * Poll canceled runs until the backend reports the retained record for each,
 * calling `onLanded` the first time any newly lands (coalesced to one call per
 * poll pass, so cancelling forty runs does not fire forty refreshes).
 *
 * Resolves once every run has landed or the budget expires. The expiry is NOT
 * silent — it refreshes one last time, because a worklist whose re-read merely
 * raced the insert is repaired by any later read, and giving up without one left
 * the console holding a stale set for the rest of the session.
 *
 * A read that fails is treated as "not yet": this is a courtesy refresh, never a
 * source of errors.
 */
export async function awaitCanceledRunRecords(
  client: RunReader,
  runIds: readonly string[],
  onLanded: () => void,
): Promise<void> {
  const pending = new Set(runIds);
  const deadline = Date.now() + CANCELED_RECORD_WAIT_MS;
  let wait = CANCELED_RECORD_POLL_MIN_MS;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    let landedAny = false;
    for (const runId of [...pending]) {
      try {
        const job = await client.getRun(runId);
        if (job.record) {
          pending.delete(runId);
          landedAny = true;
        }
      } catch {
        // Keep waiting; the next pass re-reads.
      }
    }
    if (landedAny) onLanded();
    if (pending.size === 0) return;
    if (Date.now() >= deadline) {
      // One last re-read rather than a silent give-up.
      onLanded();
      return;
    }
    wait = Math.min(
      CANCELED_RECORD_POLL_MAX_MS,
      Math.round(wait * CANCELED_RECORD_POLL_GROWTH),
    );
  }
}
