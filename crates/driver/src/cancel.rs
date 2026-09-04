//! **Cancellation disposition** — what the driver does with the run it is executing
//! once it observes that an operator killed the job.
//!
//! A kill is one signal, but it asks for two different things depending on which
//! harness is under the driver. This module holds that branch, and the race that acts
//! on it, so the decision is made once in a readable, testable place rather than inline
//! in the driver's `main`.
//!
//! # The branch
//!
//! A **gg** run is [wound down](CancelDisposition::WindDown). gg checks an in-container
//! sentinel at every turn boundary, so raising the run's
//! [latch](test_cabinet_core::RunCancellation) is a request the session will actually
//! act on: it stops at its next clean boundary, and the run then finishes through its
//! ordinary post-session path — collecting the produced tree, folding the accumulated
//! usage into metrics, writing the record. That record is the whole reason to wait: it
//! is everything the run got through before the kill, which is what an operator kills a
//! run to look at.
//!
//! A **third-party harness** run is [destroyed](CancelDisposition::DestroyNow). Such a
//! harness is a CLI the Test Cabinet drives through an `exec`; it has no wind-down
//! protocol to ask for and never observes the latch. Waiting on it therefore buys
//! nothing — it does not produce an early record, it just waits for a session that was
//! always going to run to its own natural end, minutes or tens of minutes later. What
//! the wait *costs* is concrete: the dispatcher's in-flight cap counts driver Jobs that
//! are still running in the cluster, so a canceled run that keeps its driver alive keeps
//! holding a scheduling slot, and the runs an operator queued *after* the kill trickle
//! in one at a time behind runs nobody will ever read. So the run future is dropped at
//! once, the sandbox is torn down, nothing is recorded, and the driver exits.
//!
//! # What "destroyed" does and does not promise
//!
//! The destroy path keeps nothing *of a run it interrupts*, and its edges — which runs
//! it interrupts, and how quickly — are worth stating plainly rather than discovering
//! later.
//!
//! A kill that lands anywhere in the run — including after the harness session itself
//! ended, while the run is still in its post-session tail (collecting the produced tree,
//! installing and building it, validating it) — destroys the run. The disposition is
//! decided by harness, not by how far the run got: the tail is minutes of fresh work
//! holding the same scheduling slot, and an operator who stopped everything asked for
//! the slot back, not for the tail to be finished on their behalf. A run that reaches
//! its *own* ending before the driver's next cancellation poll is a different case: the
//! race sees an ordinary [`CancelRace::Finished`] and the driver finalizes it as it
//! stood, which the backend then discards on its side (it accepts no terminal status on
//! an already-canceled job but the driver's own `canceled` report).
//!
//! "Promptly" is bounded by the poll interval plus whatever the run is currently doing:
//! the driver can only act on a kill when the run future yields, and a post-session
//! stage that blocks the task — validation shells out to a browser driver
//! synchronously — holds it off until that stage returns. The common case, a kill during
//! a session, is seconds; the worst case is the length of one blocking stage, still
//! nothing like the wind-down grace it replaces.
//!
//! # Dropping is not stopping
//!
//! Dropping the run future closes the host's end of the harness `exec` and nothing
//! more: the harness is its own process inside the sandbox and would keep running, and
//! keep spending, indefinitely. The destroy disposition is only correct in combination
//! with deleting the sandbox — see the driver binary's `teardown_sandbox`, which every
//! cancellation path calls, and which finds the sandbox by this job's id under both the
//! Kubernetes and CLI runtimes precisely because the run's own handle on it went away
//! with the dropped future. That teardown is the kill, so on this path alone its failure
//! fails the driver, handing the sandbox to the dispatcher's reaper.

#[cfg(test)]
#[path = "cancel.test.rs"]
mod tests;

use std::future::Future;
use std::time::Duration;

use test_cabinet_core::{RunCancellation, RunRequest};

/// What an observed cancellation means for the run in flight.
///
/// Decided from the run request alone, before the run starts, because it depends only
/// on the harness — see the [module docs](self) for why the two differ.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelDisposition {
    /// Ask the session to stop and wait for it, bounded by a grace period, so the run
    /// finishes through its ordinary post-session path and hands back a record of what
    /// it got through. The gg path.
    WindDown,
    /// Abandon the run immediately: drop the future, keep nothing, and let the caller
    /// tear the sandbox down and exit. The path for every harness that cannot be asked
    /// to stop.
    DestroyNow,
}

/// How a run ended once it was raced against an operator's cancellation.
///
/// `T` is the run's own outcome type — the driver's
/// `Result<RunRecord, RunFailure>` — which only two of the four variants can carry,
/// because only two of them leave a run that reached an ending.
#[derive(Debug, PartialEq, Eq)]
pub enum CancelRace<T> {
    /// The run reached its own ending; no cancellation was ever observed.
    Finished(T),
    /// The run was canceled, was asked to wind down, and did so inside the grace —
    /// so it carries the outcome its ordinary post-session path produced.
    WoundDown(T),
    /// The run was canceled and asked to wind down, but did not hand anything back
    /// inside the grace. The caller records the run from what it holds itself.
    WindDownExpired,
    /// The run was canceled under [`CancelDisposition::DestroyNow`] and abandoned. The
    /// run future is already dropped by the time this is returned, and there is
    /// deliberately nothing to record: the variant carries no payload precisely so the
    /// arm handling it *cannot* invent one.
    Destroyed,
}

/// Which disposition a cancellation of this run takes.
///
/// The predicate is [`RunRequest::is_gg`], the same seam the run pipeline already uses
/// to route a run down gg's own executor instead of the orchestrated third-party path —
/// which is exactly the distinction that matters here, since it is gg's executor that
/// implements the wind-down. Every harness that is not gg destroys, including any added
/// later: a new CLI harness has no wind-down protocol until someone writes one, so
/// defaulting it to the waiting path would silently reintroduce the held slot.
pub fn cancel_disposition(request: &RunRequest) -> CancelDisposition {
    if request.is_gg() {
        CancelDisposition::WindDown
    } else {
        CancelDisposition::DestroyNow
    }
}

/// Drive `run` to its end, racing it against `watch` — a future that resolves only when
/// an operator cancels this run — and handle the cancellation according to
/// `disposition`.
///
/// `watch` is a parameter rather than a call to the driver's own poller so that the
/// decision this function makes can be tested without a backend: a test passes
/// `std::future::ready(())` for "already canceled" and `std::future::pending()` for
/// "never canceled".
///
/// On [`CancelDisposition::WindDown`] the `cancel` latch is raised — that is the request
/// the gg session acts on — and the run is awaited for up to `grace`. On
/// [`CancelDisposition::DestroyNow`] the latch is deliberately **left un-raised**: there
/// is no session that would observe it, and raising it would only ask the engine to
/// start a wind-down whose whole point is a record this path will not keep. The run
/// future is owned here, so it is dropped before this returns and every borrow it held
/// is released — which is what lets the caller drop its event-channel sender and exit.
pub async fn race_cancellation<R, W>(
    run: R,
    watch: W,
    cancel: &RunCancellation,
    disposition: CancelDisposition,
    grace: Duration,
) -> CancelRace<R::Output>
where
    R: Future,
    W: Future<Output = ()>,
{
    tokio::pin!(run);
    tokio::select! {
        outcome = &mut run => return CancelRace::Finished(outcome),
        () = watch => {}
    }

    match disposition {
        CancelDisposition::DestroyNow => CancelRace::Destroyed,
        CancelDisposition::WindDown => {
            cancel.cancel();
            match tokio::time::timeout(grace, &mut run).await {
                Ok(outcome) => CancelRace::WoundDown(outcome),
                Err(_elapsed) => CancelRace::WindDownExpired,
            }
        }
    }
}
