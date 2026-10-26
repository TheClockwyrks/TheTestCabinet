//! Stopping: how the backend drains when it is told to.
//!
//! On `SIGTERM` the backend follows the control plane's "Graceful termination":
//!
//! 1. [`Readiness::mark_draining`] fails `/readyz` at once and ends every
//!    long-lived stream, so each client reconnects to a ready replica.
//! 2. The server keeps accepting for a further [`DRAIN_DELAY`], so a request routed
//!    by an endpoint list not yet updated still lands.
//! 3. It stops accepting and finishes every request in flight.
//! 4. It exits with status 0, at the latest [`STOP_DEADLINE`] after the signal,
//!    abandoning whatever is still running then, which keeps the exit inside the
//!    pod's termination grace.
//!
//! An interrupt (`Ctrl-C`) skips the drain delay. [`stop_signal`] installs the
//! handlers, which the binary does before its slow start, and [`serve`] sequences
//! the rest.

use std::future::Future;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::time::Instant;

use crate::readiness::Readiness;

/// How long a backend told to stop by `SIGTERM` keeps accepting after it fails
/// readiness, while its endpoint's removal from the Service propagates.
pub const DRAIN_DELAY: Duration = Duration::from_secs(5);

/// How long after the signal the backend exits however much is still running.
///
/// The backend's termination grace is 60 seconds and starts with the 5-second
/// `preStop` hook that precedes `SIGTERM`, so 50 seconds from the signal leaves a
/// margin of 5 before the kubelet would kill the process.
pub const STOP_DEADLINE: Duration = Duration::from_secs(50);

/// What told the backend to stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stop {
    /// `SIGTERM`, which Kubernetes sends a pod it stops: drain with the delay.
    Terminate,
    /// An interrupt (`Ctrl-C`, `SIGINT`) at a terminal: drain without it.
    Interrupt,
}

/// How a [`serve`] that was told to stop ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stopped {
    /// Every request in flight finished, and so did the work run after them.
    Drained,
    /// The stop deadline passed with something still running, which was abandoned.
    DeadlinePassed,
}

/// The durations [`serve`] holds to; [`DRAIN_DELAY`] and [`STOP_DEADLINE`] in the
/// binary.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// How long a `SIGTERM` keeps the server accepting after readiness fails.
    pub drain_delay: Duration,
    /// How long after the signal [`serve`] returns whatever is still running.
    pub stop_deadline: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            drain_delay: DRAIN_DELAY,
            stop_deadline: STOP_DEADLINE,
        }
    }
}

/// Install the handlers for `SIGTERM` and the interrupt, and answer a future that
/// resolves with whichever arrives first.
///
/// The handlers are installed by this call, not when the future is first polled, so
/// a signal delivered at any point afterwards is held for the future rather than
/// ending the process by the signal's default action (exit status 143 for
/// `SIGTERM`). Call it before anything that can take time, so a stop requested
/// during a slow start still exits 0. It must be called inside a Tokio runtime.
pub fn stop_signal() -> std::io::Result<impl Future<Output = Stop> + Send + 'static> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

        let mut terminate = signal(SignalKind::terminate())?;
        let mut interrupt = signal(SignalKind::interrupt())?;
        Ok(async move {
            tokio::select! {
                _ = terminate.recv() => Stop::Terminate,
                _ = interrupt.recv() => Stop::Interrupt,
            }
        })
    }
    #[cfg(not(unix))]
    {
        Ok(async move {
            // Only an interrupt reaches a process here. An error installing its
            // handler leaves no way to be asked to stop, so wait forever then.
            match tokio::signal::ctrl_c().await {
                Ok(()) => Stop::Interrupt,
                Err(err) => {
                    tracing::warn!(error = %err, "could not listen for an interrupt");
                    std::future::pending().await
                }
            }
        })
    }
}

/// Serve `router` on `listener` until `stop` resolves, then drain as the module
/// describes and run `finish` once every request in flight has finished.
///
/// Returns once all of that is done, or once `timing.stop_deadline` has passed since
/// `stop` resolved, whichever is first; what is still running then is dropped here,
/// and a blocking task it started is left to the caller's runtime shutdown.
pub async fn serve(
    listener: TcpListener,
    router: axum::Router,
    ready: Readiness,
    stop: impl Future<Output = Stop> + Send + 'static,
    finish: impl Future<Output = ()>,
    timing: Timing,
) -> std::io::Result<Stopped> {
    // The moment the stop was requested, from which the stop deadline runs.
    let (signalled_tx, signalled_rx) = tokio::sync::oneshot::channel::<Instant>();
    let shutdown = async move {
        let stop = stop.await;
        let _ = signalled_tx.send(Instant::now());
        ready.mark_draining();
        match stop {
            // A request routed by an endpoint list that has not yet dropped this pod
            // still lands for the delay; `/readyz` answers `503` meanwhile.
            Stop::Terminate => {
                tracing::info!(
                    "stopping on SIGTERM: draining, accepting for the {}s drain delay",
                    timing.drain_delay.as_secs()
                );
                tokio::time::sleep(timing.drain_delay).await;
            }
            // An interrupt at a terminal has no endpoint list to wait out.
            Stop::Interrupt => {
                tracing::info!("stopping on interrupt: draining without the drain delay");
            }
        }
        tracing::info!("no longer accepting; finishing the requests in flight");
    };
    let stopped = async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await?;
        finish.await;
        Ok::<_, std::io::Error>(Stopped::Drained)
    };
    let deadline = async move {
        match signalled_rx.await {
            Ok(signalled) => tokio::time::sleep_until(signalled + timing.stop_deadline).await,
            // The server ended without a stop being requested: only its own result
            // decides.
            Err(_) => std::future::pending().await,
        }
    };
    tokio::select! {
        result = stopped => result,
        () = deadline => {
            tracing::warn!(
                "the {}s stop deadline passed with requests still in flight; abandoning them",
                timing.stop_deadline.as_secs()
            );
            Ok(Stopped::DeadlinePassed)
        }
    }
}

#[cfg(test)]
#[path = "shutdown.test.rs"]
mod tests;
