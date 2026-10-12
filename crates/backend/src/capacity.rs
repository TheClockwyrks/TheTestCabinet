//! The backend's watch on the artifact store, and the hold it puts on the run queue
//! while any condition for storing a run's tree is not green.
//!
//! A driver that cannot store its run's tree has nowhere else to put it: its pod is
//! discarded and the run's source and build are gone. So the backend hands out a
//! run only while it has reason to believe the tree that run produces will land.
//! It polls the artifact service's `GET /capacity`, which carries the volume's free
//! space and the result of a write check, counts the runs whose drivers are waiting
//! on the store, and derives one [`ArtifactStorageStatus`] from the two. While that
//! status calls for it the run claim hands out nothing
//! (`crate::api::jobs::claim`). Queued runs wait; none is failed. The publish queue
//! is never held, since a publish reads a tree that is already stored.
//!
//! The pieces:
//!
//! - [`CapacitySettings`], the two thresholds, the recovery margin and the timing;
//! - [`classify`], the threshold rule with its hysteresis, as a pure function;
//! - [`CapacityMonitor`], the shared handle that holds the latest reading and the
//!   waiting runs, and answers [`status`](CapacityMonitor::status) and
//!   [`claim_gate`](CapacityMonitor::claim_gate) from them and the clock;
//! - [`read_capacity`], one poll of the artifact service; and
//! - [`spawn_capacity_monitor`], the loop that polls, logs each change and
//!   announces it on the console stream.
//!
//! # What holds the queue
//!
//! Seven conditions, the first that applies being the [reason](HoldReason)
//! reported: the store cannot be read, its free space is under the stop threshold,
//! its write check failed, a run in flight is waiting to store its tree, an upload
//! failed while the store read as faulty and no passing reading has arrived since,
//! publishes are failing across several runs, or an upload failed while the store
//! read as healthy and no tree has landed since.
//!
//! # Publish failures
//!
//! The sixth is not read from the store. An unpublished run keeps its tree until
//! it is published, so a release path that has stopped working fills the store as
//! surely as a volume that has stopped taking writes. The rule is
//! [`crate::publish_health`]'s, derived from the publish job table, and the monitor
//! only carries its latest answer ([`set_publish_hold`](CapacityMonitor::set_publish_hold))
//! so the hold is reported, logged and announced with the others. The run claim
//! derives it again from the table before every pass, so no claim rests on the
//! copy held here. It applies with or without an artifact service.
//!
//! # A store that cannot be read
//!
//! A failed read is acted on at once and announced only if it lasts. The moment a
//! poll fails the claim is [paused](ClaimGate::Paused): it hands out nothing and
//! touches nothing, so no run is dispatched into a store nobody can see, and no
//! queued run's display state flips for what may be one slow answer. Once the
//! latest reading is older than three poll intervals the state is
//! [`Unavailable`](ArtifactStorageState::Unavailable) and the queue is on hold in
//! the open. A store never read starts there, so a backend that has just started
//! beside a full volume dispatches nothing.
//!
//! The state is derived when it is asked for rather than when a poll lands, so a
//! reading goes stale, and the hold that follows it begins, on the clock alone. A
//! poll loop that has stalled therefore cannot leave the queue open on a reading
//! nobody has refreshed.
//!
//! # Runs waiting to store
//!
//! The waiting runs are not a latch a driver sets and clears. They are counted
//! from the job table ([`WaitingRuns`]) at every poll, claim and driver report, so
//! a driver that died without a word stops counting the moment its job is failed
//! as lost.
//!
//! # Evidence from uploads
//!
//! What the monitor does keep is that an upload failed for a reason that was the
//! store's ([`upload_failed`](CapacityMonitor::upload_failed)), and what the store
//! read as when it did. The queue then reopens on evidence that the fault is gone
//! and never on the last waiter leaving. A failure that arrived while the store
//! read as faulty is one the watch can see, so a passing reading with nothing
//! waiting ends it. A failure that arrived while the store read as healthy is one
//! the write check is blind to, so a passing reading proves nothing: the claim is
//! then [limited to one run in flight](ClaimGate::Trial) until a tree lands
//! ([`tree_landed`](CapacityMonitor::tree_landed)).
//!
//! # Recovery
//!
//! [`Unavailable`](ArtifactStorageState::Unavailable) and
//! [`Unwritable`](ArtifactStorageState::Unwritable) are entered on the first
//! reading that calls for them and left only after three consecutive passing
//! readings, so one good answer from a store that fails intermittently does not
//! reopen the queue for the dispatcher to fill.

use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::time::Instant;

use crate::publish_health::PublishHold;
use crate::relay::Notifier;

/// One mebibyte, the unit the threshold settings are given in.
pub const MIB: u64 = 1024 * 1024;

/// How many poll intervals a reading stays current for. Past it the reading is
/// stale and the state is [`ArtifactStorageState::Unavailable`]: three intervals is
/// two consecutive polls that brought nothing back, so one slow answer changes
/// nothing a console shows.
const STALE_AFTER_POLLS: u32 = 3;

/// How many poll intervals a reading may age before the claim is paused on the
/// clock alone, with no failed poll to say so: two is one poll that never
/// reported back at all, which is a poll loop that has stalled.
const PAUSE_AFTER_POLLS: u32 = 2;

/// How many consecutive passing readings end an announced
/// [`Unavailable`](ArtifactStorageState::Unavailable) or
/// [`Unwritable`](ArtifactStorageState::Unwritable) state. One is what a store
/// that fails every other poll gives, and the dispatcher fills its whole lane in
/// the ten seconds that one would open.
const RECOVER_AFTER_READINGS: u32 = 3;

/// How long one capacity poll may take. The answer is a `statvfs` and one small
/// synced write on the service's side, so a slow one is a service, or a volume,
/// that is not answering.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// The thresholds and timing of the capacity watch
/// (`TCAB_ARTIFACT_FREE_*`, `TCAB_ARTIFACT_CAPACITY_POLL_SECONDS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapacitySettings {
    /// Free space under which the store is running low
    /// (`TCAB_ARTIFACT_FREE_WARN_MB`).
    pub warn_bytes: u64,
    /// Free space under which new runs are put on hold
    /// (`TCAB_ARTIFACT_FREE_STOP_MB`). Never above `warn_bytes`.
    pub stop_bytes: u64,
    /// How far above a crossed threshold free space must rise before the state
    /// recovers (`TCAB_ARTIFACT_FREE_RECOVER_MB`).
    pub recover_bytes: u64,
    /// Interval between two readings (`TCAB_ARTIFACT_CAPACITY_POLL_SECONDS`).
    pub poll_interval: Duration,
}

impl Default for CapacitySettings {
    /// The stop threshold is the reserve for the runs in flight. The dispatcher
    /// runs up to eight at once and the largest tree observed is about 180 MB, so
    /// the eight stored trees take about 1.4 GB of it. An upload needs about twice
    /// its size while it lands, because the tar is spooled onto the volume it is
    /// unpacked on, and the rest of the reserve is that transient room: enough for
    /// three of the eight to land at the same moment, not for all of them. A
    /// deployment that raises the dispatcher's lane raises this threshold with it.
    /// The warn threshold sits a gibibyte above it so an operator hears about the
    /// store before the queue stops.
    ///
    /// The recovery margin is larger than one tree, so a single run landing or
    /// being deleted at a threshold does not flip the state.
    ///
    /// Ten seconds between readings is frequent next to the minutes a run takes
    /// from its claim to its upload, and a `statvfs` and a one-block write each is
    /// no load.
    fn default() -> Self {
        Self {
            warn_bytes: 3072 * MIB,
            stop_bytes: 2048 * MIB,
            recover_bytes: 256 * MIB,
            poll_interval: Duration::from_secs(10),
        }
    }
}

impl CapacitySettings {
    /// How old a reading may be before it no longer describes the store.
    pub fn stale_after(&self) -> Duration {
        self.poll_interval.saturating_mul(STALE_AFTER_POLLS)
    }

    /// How old a reading may be before the claim is paused with no failed poll
    /// behind it.
    pub fn pause_after(&self) -> Duration {
        self.poll_interval.saturating_mul(PAUSE_AFTER_POLLS)
    }
}

/// What a reading of the store's free space amounts to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// At or above the warn threshold.
    Ok,
    /// Under the warn threshold.
    Low,
    /// Under the stop threshold.
    Blocked,
}

/// Classify `free_bytes` against the thresholds, given the level the previous
/// reading was classified as.
///
/// A level is entered the moment free space is under its threshold, and left only
/// once free space is `recover_bytes` above that threshold. The asymmetry is what
/// keeps a store hovering at a threshold in one state: without it each poll on
/// either side of the line would stop and restart the queue.
pub fn classify(previous: Level, free_bytes: u64, settings: &CapacitySettings) -> Level {
    let stop_exit = settings.stop_bytes.saturating_add(settings.recover_bytes);
    let warn_exit = settings.warn_bytes.saturating_add(settings.recover_bytes);
    if free_bytes < settings.stop_bytes {
        return Level::Blocked;
    }
    match previous {
        Level::Blocked if free_bytes < stop_exit => Level::Blocked,
        // Leaving `Blocked` passes through `Low` on the way up, so it clears the
        // warn threshold by the margin too before it reads `Ok`.
        Level::Blocked | Level::Low if free_bytes < warn_exit => Level::Low,
        Level::Ok if free_bytes < settings.warn_bytes => Level::Low,
        _ => Level::Ok,
    }
}

/// The state of the artifact store as the backend sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum ArtifactStorageState {
    /// Free space is at or above the warn threshold and the write check passed.
    Ok,
    /// Free space is under the warn threshold. Runs are still dispatched.
    Low,
    /// Free space is under the stop threshold. New runs are on hold.
    Blocked,
    /// The store has room but the service's write check failed: the volume is
    /// read-only, faulted, or no longer the service's to write. New runs are on
    /// hold. A full volume fails the check as well, and reads `blocked`.
    Unwritable,
    /// The backend holds no current reading: the artifact service could not be
    /// read for three poll intervals, or has not been read yet. New runs are on
    /// hold.
    Unavailable,
    /// No artifact service is configured, so nothing is watched and nothing is
    /// held.
    Unmonitored,
}

/// Which condition is holding the run queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum HoldReason {
    /// The store cannot be read (the state is `unavailable`).
    Unreadable,
    /// Free space is under the stop threshold (the state is `blocked`).
    LowSpace,
    /// The store's write check failed (the state is `unwritable`).
    Unwritable,
    /// A run in flight is waiting to store its tree.
    UploadsWaiting,
    /// An upload failed while the store read as faulty, and no passing reading has
    /// arrived since with no run waiting.
    WriteCheckPending,
    /// Publishes are failing: the most recent finished publish jobs are failures
    /// of several different runs with no success among them
    /// ([`crate::publish_health`]). Ahead of [`ProvingStore`](Self::ProvingStore)
    /// because nothing is handed out under it.
    PublishFailing,
    /// An upload failed while the store read as healthy, so the write check cannot
    /// see what failed it, and no tree has landed since. The one reason under which
    /// a run is still handed out: one at a time, while no other run is in flight.
    ProvingStore,
}

/// The backend's current reading of the artifact store: the body of
/// `GET /artifacts/capacity` and the payload of the console stream's `storage`
/// frame.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ArtifactStorageStatus {
    /// The state the latest reading amounts to.
    pub state: ArtifactStorageState,
    /// Whether the run queue is being held. It is `true` exactly when
    /// [`hold_reason`](Self::hold_reason) is present. No queued run is handed to
    /// the dispatcher while it is, except under
    /// [`HoldReason::ProvingStore`], which hands out one run at a time.
    pub runs_on_hold: bool,
    /// Which condition is holding the queue: the first that applies, in the order
    /// [`HoldReason`] lists them. Absent while the queue is open.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub hold_reason: Option<HoldReason>,
    /// How many runs in flight are waiting to store their trees: the jobs in the
    /// `storing` state.
    pub runs_waiting_to_store: u32,
    /// The error text behind the hold, when there is one: why the latest poll
    /// brought no reading back, why the write check failed, the latest reason a
    /// driver reported for an upload that failed, or under
    /// [`HoldReason::PublishFailing`] the reason the latest failed publish job
    /// recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
    /// How many different runs have failed to publish since a publish last
    /// succeeded. Present while that is enough to hold the queue, under whichever
    /// reason is reported.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub publish_failing_runs: Option<u32>,
    /// Free bytes on the store's volume as of the latest reading. Absent until a
    /// reading has arrived.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub free_bytes: Option<u64>,
    /// The size of the store's volume as of the latest reading. Absent until a
    /// reading has arrived.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub total_bytes: Option<u64>,
    /// Whether the store's write check passed as of the latest reading. Absent
    /// until a reading has arrived.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub writable: Option<bool>,
    /// Free space under which the state is `low`.
    pub warn_bytes: u64,
    /// Free space under which the state is `blocked`.
    pub stop_bytes: u64,
}

/// One reading of the artifact store: the artifact service's `GET /capacity` body.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreCapacity {
    /// Bytes an upload can still be written into.
    pub free_bytes: u64,
    /// The size of the filesystem the store is on.
    pub total_bytes: u64,
    /// Whether the service's write check passed: it created, synced and removed a
    /// small file where uploads are spooled. A body without the field is from a
    /// service that makes no check, and is read as passing, so a backend rolled
    /// ahead of its artifact service holds nothing on that account.
    #[serde(default = "writable_when_unchecked")]
    pub writable: bool,
    /// Why the write check failed, when it did.
    #[serde(default)]
    pub write_error: Option<String>,
}

/// The [`StoreCapacity::writable`] of a body that does not carry it.
fn writable_when_unchecked() -> bool {
    true
}

impl StoreCapacity {
    /// A reading of a store whose write check passed.
    pub fn writable(free_bytes: u64, total_bytes: u64) -> Self {
        Self {
            free_bytes,
            total_bytes,
            writable: true,
            write_error: None,
        }
    }

    /// A reading of a store whose write check failed with `error`.
    pub fn unwritable(free_bytes: u64, total_bytes: u64, error: impl Into<String>) -> Self {
        Self {
            free_bytes,
            total_bytes,
            writable: false,
            write_error: Some(error.into()),
        }
    }
}

/// The runs in flight whose drivers are waiting to store their trees, as the job
/// table has them at one moment.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WaitingRuns {
    /// How many jobs are in the `storing` state.
    pub count: u32,
    /// The reason the most recently updated of them reported.
    pub reason: Option<String>,
}

/// What the run claim may do right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimGate {
    /// Hand out the next claimable run.
    Open,
    /// Hand out nothing and leave the queue exactly as it is: the latest read of
    /// the store failed, and nothing is announced until that has lasted.
    Paused,
    /// Hand out the next claimable run only while no run is in flight
    /// ([`HoldReason::ProvingStore`]): one run at a time proves a store whose
    /// write check passes although an upload to it failed.
    Trial,
    /// Hand out nothing, and show every waiting run as held.
    Hold,
}

/// Why one capacity poll brought no reading back.
#[derive(Debug, thiserror::Error)]
pub enum CapacityReadError {
    /// The service answered a non-success status.
    #[error("the artifact service answered HTTP {0}")]
    Refused(reqwest::StatusCode),
    /// The service answered a non-success status and said why.
    #[error("the artifact service answered HTTP {status}: {message}")]
    Explained {
        /// The status the service answered.
        status: reqwest::StatusCode,
        /// The message of the error body it answered with.
        message: String,
    },
    /// The request got no answer, or an answer that could not be read.
    #[error("the artifact service could not be reached: {0}")]
    Transport(#[from] reqwest::Error),
}

/// Read the artifact store's capacity (`GET /capacity`), presenting the shared
/// control-plane service token the route is gated on.
pub async fn read_capacity(
    http: &reqwest::Client,
    base: &str,
    token: &str,
) -> Result<StoreCapacity, CapacityReadError> {
    let url = format!("{}/capacity", base.trim_end_matches('/'));
    let response = http
        .get(&url)
        .bearer_auth(token)
        .timeout(READ_TIMEOUT)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        // The service's error envelope is `{ "error": { "message" } }`. Its text
        // is what an operator needs, a hung volume among the things it says.
        let message = response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|body| body["error"]["message"].as_str().map(str::to_string));
        return Err(match message {
            Some(message) => CapacityReadError::Explained { status, message },
            None => CapacityReadError::Refused(status),
        });
    }
    Ok(response.json().await?)
}

/// The latest reading and when it was taken.
#[derive(Debug, Clone)]
struct Reading {
    capacity: StoreCapacity,
    at: Instant,
}

/// What a console is told about: a change in any of these is announced.
type Announced = (
    ArtifactStorageState,
    Option<HoldReason>,
    u32,
    Option<String>,
    Option<u32>,
);

/// What the monitor holds whether or not a store is watched.
#[derive(Debug)]
struct Shared {
    /// The hold publish failures call for, as last derived from the publish job
    /// table.
    publish_hold: Option<PublishHold>,
    /// What [`CapacityMonitor::take_change`] last returned. `None` until the first
    /// call of a watching monitor, which therefore always reports.
    announced: Option<Announced>,
}

/// An announced state the store has to earn its way out of.
#[derive(Debug, Clone)]
struct Fault {
    /// The state the fault was announced as:
    /// [`Unavailable`](ArtifactStorageState::Unavailable) or
    /// [`Unwritable`](ArtifactStorageState::Unwritable).
    state: ArtifactStorageState,
    /// The error text the fault was entered with.
    detail: Option<String>,
    /// How many passing readings have arrived in a row since.
    passing: u32,
}

/// An upload failed for a reason that was the store's, and nothing has shown the
/// fault gone.
#[derive(Debug, Clone)]
struct Unproven {
    /// The latest reason a driver reported.
    reason: Option<String>,
    /// Whether the store read as healthy when the latest failure arrived, which
    /// makes the fault one the write check cannot see.
    blind: bool,
}

/// What the monitor remembers between polls.
#[derive(Debug)]
struct Tracker {
    /// The level the latest reading was classified as. Kept across an outage, so
    /// the hysteresis resumes from where the store was when it was last read.
    level: Level,
    /// The latest reading, if any has arrived.
    reading: Option<Reading>,
    /// Why the latest poll brought no reading back. Cleared by a reading.
    last_error: Option<String>,
    /// The runs waiting to store their trees, as last counted.
    waiting: WaitingRuns,
    /// The announced unreadable or unwritable state the store is recovering
    /// from, if any.
    fault: Option<Fault>,
    /// The failed upload nothing has yet disproved, if any.
    unproven: Option<Unproven>,
}

impl Tracker {
    /// Whether every condition the watch can see is green at `now`: a current
    /// reading whose write check passed, room above the stop threshold, no fault
    /// being recovered from, and a latest poll that answered.
    fn reads_green(&self, now: Instant, stale_after: Duration) -> bool {
        self.fault.is_none()
            && self.last_error.is_none()
            && self.level != Level::Blocked
            && self.reading.as_ref().is_some_and(|reading| {
                reading.capacity.writable
                    && now.saturating_duration_since(reading.at) <= stale_after
            })
    }
}

/// A change [`CapacityMonitor::take_change`] reports once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapacityChange {
    /// The state before the change.
    pub previous: ArtifactStorageState,
    /// Whether runs were on hold before the change.
    pub previously_on_hold: bool,
    /// The reason runs were on hold for before the change, if they were.
    pub previous_hold_reason: Option<HoldReason>,
    /// The status after it.
    pub status: ArtifactStorageStatus,
}

/// The shared handle on the capacity watch: written by the poll loop and the job
/// routes, read by the run claim, the status route and the console stream.
#[derive(Debug, Clone)]
pub struct CapacityMonitor {
    settings: CapacitySettings,
    /// `None` when no artifact service is configured, which is the state
    /// [`ArtifactStorageState::Unmonitored`].
    tracker: Option<Arc<Mutex<Tracker>>>,
    /// The publish-failure hold and the last announcement. Locked after the
    /// tracker wherever both are.
    shared: Arc<Mutex<Shared>>,
}

impl CapacityMonitor {
    /// A monitor of a deployment with no artifact service: it reports
    /// [`ArtifactStorageState::Unmonitored`] and holds a run only for
    /// [publish failures](HoldReason::PublishFailing).
    pub fn unmonitored(settings: CapacitySettings) -> Self {
        Self {
            settings,
            tracker: None,
            shared: Arc::new(Mutex::new(Shared {
                publish_hold: None,
                // An unwatched store has no starting state to report, so only a
                // change from this one is announced.
                announced: Some((ArtifactStorageState::Unmonitored, None, 0, None, None)),
            })),
        }
    }

    /// A monitor of a configured artifact service. It holds no reading yet, so it
    /// starts [`ArtifactStorageState::Unavailable`] with the run queue on hold
    /// until the first reading: nothing is known about a store never read, and the
    /// volume beside a backend that has just started may be full.
    pub fn watching(settings: CapacitySettings) -> Self {
        Self {
            settings,
            tracker: Some(Arc::new(Mutex::new(Tracker {
                level: Level::Ok,
                reading: None,
                last_error: None,
                waiting: WaitingRuns::default(),
                fault: None,
                unproven: None,
            }))),
            shared: Arc::new(Mutex::new(Shared {
                publish_hold: None,
                announced: None,
            })),
        }
    }

    /// The settings this monitor classifies with.
    pub fn settings(&self) -> &CapacitySettings {
        &self.settings
    }

    /// Record a reading taken now.
    pub fn record(&self, capacity: StoreCapacity) {
        let Some(tracker) = &self.tracker else {
            return;
        };
        let mut tracker = tracker.lock().expect("capacity tracker mutex poisoned");
        let now = Instant::now();
        let stale_after = self.settings.stale_after();
        // A reading that had aged out was announced as an unreadable store, which
        // this one reading does not end.
        let was_stale = tracker
            .reading
            .as_ref()
            .is_some_and(|reading| now.saturating_duration_since(reading.at) > stale_after);
        if was_stale && tracker.fault.is_none() {
            tracker.fault = Some(Fault {
                state: ArtifactStorageState::Unavailable,
                detail: tracker.last_error.clone(),
                passing: 0,
            });
        }
        tracker.level = classify(tracker.level, capacity.free_bytes, &self.settings);
        if !capacity.writable {
            tracker.fault = Some(Fault {
                state: ArtifactStorageState::Unwritable,
                detail: Some(
                    capacity
                        .write_error
                        .clone()
                        .unwrap_or_else(|| "the write check failed".to_string()),
                ),
                passing: 0,
            });
        } else if let Some(fault) = &mut tracker.fault {
            fault.passing += 1;
            if fault.passing >= RECOVER_AFTER_READINGS {
                tracker.fault = None;
            }
        }
        tracker.reading = Some(Reading { capacity, at: now });
        tracker.last_error = None;
        // The evidence that ends a failure the watch could see: the store reads
        // green again, and nothing is still waiting on it. A failure it could not
        // see is ended by a tree landing alone.
        let seen_fault_gone = tracker.waiting.count == 0
            && tracker
                .unproven
                .as_ref()
                .is_some_and(|unproven| !unproven.blind)
            && tracker.reads_green(now, stale_after);
        if seen_fault_gone {
            tracker.unproven = None;
        }
    }

    /// Record that a poll taken now brought no reading back, and why.
    pub fn record_failure(&self, error: &CapacityReadError) {
        let Some(tracker) = &self.tracker else {
            return;
        };
        let mut tracker = tracker.lock().expect("capacity tracker mutex poisoned");
        tracker.last_error = Some(error.to_string());
        if let Some(fault) = &mut tracker.fault {
            fault.passing = 0;
        }
    }

    /// Record the runs waiting to store their trees, as the job table has them
    /// now. A run found waiting with no failed upload on record, which is what a
    /// backend that restarted during a wait finds, is recorded as
    /// [one](Self::upload_failed).
    pub fn set_waiting(&self, waiting: WaitingRuns) {
        let Some(tracker) = &self.tracker else {
            return;
        };
        let mut tracker = tracker.lock().expect("capacity tracker mutex poisoned");
        if waiting.count > 0 && tracker.unproven.is_none() {
            let blind = tracker.reads_green(Instant::now(), self.settings.stale_after());
            tracker.unproven = Some(Unproven {
                reason: waiting.reason.clone(),
                blind,
            });
        }
        tracker.waiting = waiting;
    }

    /// Record that an upload of a run's tree failed just now for `reason`, a
    /// condition of the store rather than of the run. Called for every such
    /// report a driver makes, whatever state its job is in.
    ///
    /// What the store reads as at this moment decides what ends the hold that
    /// follows: a passing reading when the watch can see a fault, and a tree
    /// landing when it cannot.
    pub fn upload_failed(&self, reason: Option<&str>) {
        let Some(tracker) = &self.tracker else {
            return;
        };
        let mut tracker = tracker.lock().expect("capacity tracker mutex poisoned");
        let blind = tracker.reads_green(Instant::now(), self.settings.stale_after());
        let reason = reason
            .map(str::to_string)
            .or_else(|| tracker.unproven.take().and_then(|unproven| unproven.reason));
        tracker.unproven = Some(Unproven { reason, blind });
    }

    /// Record that a run's tree landed just now: the store took a whole upload,
    /// which ends whatever a failed one left in doubt.
    pub fn tree_landed(&self) {
        let Some(tracker) = &self.tracker else {
            return;
        };
        let mut tracker = tracker.lock().expect("capacity tracker mutex poisoned");
        tracker.unproven = None;
    }

    /// Start as a store an upload failed on with nothing seen to be wrong: what a
    /// backend that starts finds when the last finished run's tree was not stored.
    /// The memory of a failed upload is the process's own, and this is what keeps
    /// a restart during a store fault from reopening the whole queue.
    pub fn restore_unproven(&self, reason: &str) {
        let Some(tracker) = &self.tracker else {
            return;
        };
        let mut tracker = tracker.lock().expect("capacity tracker mutex poisoned");
        tracker.unproven = Some(Unproven {
            reason: Some(reason.to_string()),
            blind: true,
        });
    }

    /// Record the hold publish failures call for, as just derived from the
    /// publish job table: `None` when they call for none.
    ///
    /// The monitor decides nothing about it. It carries the answer so the status,
    /// the log and the console stream report this hold with the store's own.
    pub fn set_publish_hold(&self, hold: Option<PublishHold>) {
        self.shared
            .lock()
            .expect("capacity shared mutex poisoned")
            .publish_hold = hold;
    }

    /// The store's status as of now.
    pub fn status(&self) -> ArtifactStorageStatus {
        match &self.tracker {
            Some(tracker) => {
                let tracker = tracker.lock().expect("capacity tracker mutex poisoned");
                let shared = self.shared.lock().expect("capacity shared mutex poisoned");
                self.status_of(Some(&tracker), &shared, Instant::now())
            }
            None => {
                let shared = self.shared.lock().expect("capacity shared mutex poisoned");
                self.status_of(None, &shared, Instant::now())
            }
        }
    }

    /// Whether the run queue is being held right now.
    pub fn runs_on_hold(&self) -> bool {
        self.status().runs_on_hold
    }

    /// What the run claim may do right now. The claim asks this before every
    /// pass.
    ///
    /// [`ClaimGate::Hold`] is the announced hold. [`ClaimGate::Paused`] is the
    /// stretch before an unreadable store is announced as one: the latest poll
    /// failed, or the latest reading has aged past two poll intervals with no poll
    /// reporting at all. [`ClaimGate::Trial`] is the one hold that still hands out
    /// a run, and it too is paused while the store's latest read is unconfirmed.
    pub fn claim_gate(&self) -> ClaimGate {
        let publish_held = self
            .shared
            .lock()
            .expect("capacity shared mutex poisoned")
            .publish_hold
            .is_some();
        self.claim_gate_with(publish_held)
    }

    /// [`claim_gate`](Self::claim_gate) for a caller that has just derived whether
    /// publish failures hold new runs: the store's own gate with `publish_held`
    /// laid over it, whatever answer the monitor last recorded. The run claim asks
    /// this, so it never rests on a copy another caller may have overwritten.
    ///
    /// The publish hold holds the queue wherever the store would hand out a run,
    /// including the one run at a time of [`ClaimGate::Trial`].
    pub fn claim_gate_with(&self, publish_held: bool) -> ClaimGate {
        let Some(tracker) = &self.tracker else {
            return if publish_held {
                ClaimGate::Hold
            } else {
                ClaimGate::Open
            };
        };
        let tracker = tracker.lock().expect("capacity tracker mutex poisoned");
        let now = Instant::now();
        let proving = match self.store_status_of(&tracker, now).hold_reason {
            Some(HoldReason::ProvingStore) if publish_held => return ClaimGate::Hold,
            Some(HoldReason::ProvingStore) => true,
            Some(_) => return ClaimGate::Hold,
            None if publish_held => return ClaimGate::Hold,
            None => false,
        };
        let unconfirmed = tracker.last_error.is_some()
            || tracker.reading.as_ref().is_none_or(|reading| {
                now.saturating_duration_since(reading.at) > self.settings.pause_after()
            });
        if unconfirmed {
            ClaimGate::Paused
        } else if proving {
            ClaimGate::Trial
        } else {
            ClaimGate::Open
        }
    }

    /// The change since the last call, if the state, the hold's reason, the number
    /// of waiting runs, the reported error or the number of runs failing to
    /// publish differs from what that call saw. Each change is therefore logged and
    /// announced exactly once however long it lasts. The first call of a watching
    /// monitor always reports, so the state a backend starts in is logged like any
    /// other. An unmonitored one reports only a change from holding nothing.
    pub fn take_change(&self) -> Option<CapacityChange> {
        let tracker = self
            .tracker
            .as_ref()
            .map(|tracker| tracker.lock().expect("capacity tracker mutex poisoned"));
        let mut shared = self.shared.lock().expect("capacity shared mutex poisoned");
        let status = self.status_of(tracker.as_deref(), &shared, Instant::now());
        let now = (
            status.state,
            status.hold_reason,
            status.runs_waiting_to_store,
            status.detail.clone(),
            status.publish_failing_runs,
        );
        if shared.announced.as_ref() == Some(&now) {
            return None;
        }
        // A monitor that has announced nothing was holding the queue on a store it
        // had never read.
        let (previous, previous_hold_reason) = match shared.announced.replace(now) {
            Some((state, reason, _, _, _)) => (state, reason),
            None => (
                ArtifactStorageState::Unavailable,
                Some(HoldReason::Unreadable),
            ),
        };
        Some(CapacityChange {
            previous,
            previously_on_hold: previous_hold_reason.is_some(),
            previous_hold_reason,
            status,
        })
    }

    /// Log and announce the change since the last announcement, if there is one.
    /// Called by the poll loop after each poll, and by the job routes after a
    /// driver's report changes the number of waiting runs, so a console hears of a
    /// hold as it begins rather than at the next poll.
    pub fn announce(&self, notifier: &Notifier) {
        if let Some(change) = self.take_change() {
            log_change(&change);
            notifier.publish_storage(change.status);
        }
    }

    /// Derive the status from what the monitor holds and the time: the store's
    /// own status, or the unmonitored one with no tracker, with the publish-failure
    /// hold laid over it.
    ///
    /// The publish hold is the reported reason when the store gives none, and in
    /// place of [`HoldReason::ProvingStore`], under which a run would still be
    /// handed out. Every other reason of the store's leads, being the one that
    /// loses a tree.
    fn status_of(
        &self,
        tracker: Option<&Tracker>,
        shared: &Shared,
        now: Instant,
    ) -> ArtifactStorageStatus {
        let mut status = match tracker {
            Some(tracker) => self.store_status_of(tracker, now),
            None => ArtifactStorageStatus {
                state: ArtifactStorageState::Unmonitored,
                runs_on_hold: false,
                hold_reason: None,
                runs_waiting_to_store: 0,
                detail: None,
                publish_failing_runs: None,
                free_bytes: None,
                total_bytes: None,
                writable: None,
                warn_bytes: self.settings.warn_bytes,
                stop_bytes: self.settings.stop_bytes,
            },
        };
        if let Some(hold) = &shared.publish_hold {
            status.publish_failing_runs = Some(hold.failing_runs);
            if matches!(status.hold_reason, None | Some(HoldReason::ProvingStore)) {
                status.hold_reason = Some(HoldReason::PublishFailing);
                status.runs_on_hold = true;
                status.detail = hold.latest_error.clone();
            }
        }
        status
    }

    /// Derive the store's own status from what the tracker holds and the time.
    fn store_status_of(&self, tracker: &Tracker, now: Instant) -> ArtifactStorageStatus {
        let stale_after = self.settings.stale_after();
        let current = tracker
            .reading
            .as_ref()
            .filter(|reading| now.saturating_duration_since(reading.at) <= stale_after);
        let state = match (current, &tracker.fault) {
            // A store never read, and one not read for three intervals: nothing
            // says either can take a tree.
            (None, _) => ArtifactStorageState::Unavailable,
            // A full volume fails the write check too, and "full" is the
            // condition an operator can act on.
            (Some(_), _) if tracker.level == Level::Blocked => ArtifactStorageState::Blocked,
            // Announced, and not yet out of it by three passing readings.
            (Some(_), Some(fault)) => fault.state,
            (Some(_), None) if tracker.level == Level::Low => ArtifactStorageState::Low,
            (Some(_), None) => ArtifactStorageState::Ok,
        };
        let hold_reason = match state {
            ArtifactStorageState::Unavailable => Some(HoldReason::Unreadable),
            ArtifactStorageState::Blocked => Some(HoldReason::LowSpace),
            ArtifactStorageState::Unwritable => Some(HoldReason::Unwritable),
            _ if tracker.waiting.count > 0 => Some(HoldReason::UploadsWaiting),
            _ => tracker.unproven.as_ref().map(|unproven| {
                if unproven.blind {
                    HoldReason::ProvingStore
                } else {
                    HoldReason::WriteCheckPending
                }
            }),
        };
        let fault_detail = || {
            tracker
                .fault
                .as_ref()
                .and_then(|fault| fault.detail.clone())
        };
        let detail = match hold_reason {
            Some(HoldReason::Unreadable) => tracker.last_error.clone().or_else(fault_detail),
            Some(HoldReason::Unwritable) => fault_detail(),
            Some(
                HoldReason::UploadsWaiting
                | HoldReason::WriteCheckPending
                | HoldReason::ProvingStore,
            ) => tracker.waiting.reason.clone().or_else(|| {
                tracker
                    .unproven
                    .as_ref()
                    .and_then(|unproven| unproven.reason.clone())
            }),
            Some(HoldReason::LowSpace | HoldReason::PublishFailing) | None => None,
        };
        let reading = tracker.reading.as_ref().map(|reading| &reading.capacity);
        ArtifactStorageStatus {
            state,
            runs_on_hold: hold_reason.is_some(),
            hold_reason,
            runs_waiting_to_store: tracker.waiting.count,
            detail,
            publish_failing_runs: None,
            free_bytes: reading.map(|capacity| capacity.free_bytes),
            total_bytes: reading.map(|capacity| capacity.total_bytes),
            writable: reading.map(|capacity| capacity.writable),
            warn_bytes: self.settings.warn_bytes,
            stop_bytes: self.settings.stop_bytes,
        }
    }
}

/// What the end of a publish-failure hold is logged as.
const PUBLISH_HOLD_ENDED: &str = "publish failures no longer hold new runs";

/// The log line a change is announced with: its level and its message. `None` for
/// the one state that is never entered by a change.
///
/// Entering a hold is at least a warning and leaving one for an open queue with
/// room is `info`. Split from [`log_change`] so the level each change calls for is
/// a value a test reads.
fn announcement(change: &CapacityChange) -> Option<(tracing::Level, &'static str)> {
    use tracing::Level as Log;
    let status = &change.status;
    match (status.state, status.hold_reason) {
        (_, Some(HoldReason::PublishFailing)) => Some((
            Log::WARN,
            "publishing is failing; new runs are on hold until a publish succeeds",
        )),
        // The end of a publish hold is said in those words whatever the store
        // reads as, an unwatched one included. The words claim no success: the
        // hold also ends when too few failing runs are left to count.
        (_, None) if change.previous_hold_reason == Some(HoldReason::PublishFailing) => {
            Some((Log::INFO, PUBLISH_HOLD_ENDED))
        }
        (ArtifactStorageState::Unmonitored, _) => None,
        (_, Some(HoldReason::LowSpace)) => Some((
            Log::ERROR,
            "artifact storage is full; new runs are on hold until space is freed",
        )),
        (_, Some(HoldReason::Unreadable)) => Some((
            Log::ERROR,
            "the artifact store cannot be read; new runs are on hold until it is",
        )),
        (_, Some(HoldReason::Unwritable)) => Some((
            Log::ERROR,
            "the artifact store cannot be written to; new runs are on hold until its write check passes",
        )),
        (_, Some(HoldReason::UploadsWaiting)) => Some((
            Log::WARN,
            "finished runs are waiting to store their artifacts; new runs are on hold until they have",
        )),
        (_, Some(HoldReason::WriteCheckPending)) => Some((
            Log::WARN,
            "an upload failed on a store that read as faulty; new runs stay on hold until a reading passes",
        )),
        (_, Some(HoldReason::ProvingStore)) => Some((
            Log::WARN,
            "an upload failed on a store whose write check passes; one run at a time is dispatched until a tree lands",
        )),
        (ArtifactStorageState::Low, None) => Some((
            Log::WARN,
            "artifact storage is running low; new runs are being dispatched",
        )),
        (_, None) => Some((
            Log::INFO,
            "the artifact store is taking writes and has room; new runs are being dispatched",
        )),
    }
}

/// Whether `change` is a publish-failure hold ending while another reason goes on
/// holding new runs. A store reason that merely takes the lead over a publish hold
/// still in force is not one: the status then still counts failing runs.
fn publish_hold_ended_under_another(change: &CapacityChange) -> bool {
    change.previous_hold_reason == Some(HoldReason::PublishFailing)
        && change.status.hold_reason.is_some()
        && change.status.hold_reason != Some(HoldReason::PublishFailing)
        && change.status.publish_failing_runs.is_none()
}

/// Log one change, at the level it calls for. Every line carries the same fields:
/// the reason for the hold, the number of runs waiting to store, and the error
/// text behind the condition.
fn log_change(change: &CapacityChange) {
    let Some((level, message)) = announcement(change) else {
        return;
    };
    let status = &change.status;
    let (free_bytes, warn_bytes, stop_bytes) =
        (status.free_bytes, status.warn_bytes, status.stop_bytes);
    let (previous, resumed) = (
        change.previous,
        change.previously_on_hold && !status.runs_on_hold,
    );
    let (state, hold_reason, waiting) = (
        status.state,
        status.hold_reason,
        status.runs_waiting_to_store,
    );
    let (writable, error) = (status.writable, status.detail.as_deref());
    let publish_failing_runs = status.publish_failing_runs;
    // A publish hold that ends under another reason is said on a line of its own:
    // the line below is the other reason's, and would otherwise be the only one.
    if publish_hold_ended_under_another(change) {
        tracing::info!(
            hold_reason = ?hold_reason,
            "{PUBLISH_HOLD_ENDED}; new runs stay on hold for another reason"
        );
    }
    // `tracing`'s macros take their level as a constant, so the level picks the
    // macro.
    macro_rules! emit {
        ($macro:ident) => {
            tracing::$macro!(
                state = ?state,
                runs_on_hold = status.runs_on_hold,
                hold_reason = ?hold_reason,
                runs_waiting_to_store = waiting,
                publish_failing_runs,
                free_bytes,
                warn_bytes,
                stop_bytes,
                writable,
                previous = ?previous,
                resumed,
                error,
                "{message}"
            )
        };
    }
    match level {
        tracing::Level::ERROR => emit!(error),
        tracing::Level::WARN => emit!(warn),
        _ => emit!(info),
    }
}

/// Take one reading through `read`, count the waiting runs through `waiting`,
/// record both, and log and announce the change they produced, if any.
async fn poll_once<R, F, W, G>(
    monitor: &CapacityMonitor,
    notifier: &Notifier,
    read: &mut R,
    waiting: &mut W,
) where
    R: FnMut() -> F,
    F: Future<Output = Result<StoreCapacity, CapacityReadError>>,
    W: FnMut() -> G,
    G: Future<Output = Option<WaitingRuns>>,
{
    // The count comes first, so the reading recorded after it is judged against
    // the runs waiting now: a passing write check ends a hold only when nothing
    // is still waiting.
    if let Some(waiting) = waiting().await {
        monitor.set_waiting(waiting);
    }
    match read().await {
        Ok(capacity) => {
            crate::metrics::record_artifact_capacity(capacity.free_bytes, capacity.total_bytes);
            monitor.record(capacity);
        }
        // Debug, because a failed poll is repeated every interval for as long as the
        // outage lasts. The change of state it leads to is logged loudly, and
        // carries this error.
        Err(err) => {
            tracing::debug!(error = %err, "could not read the artifact store's capacity");
            monitor.record_failure(&err);
        }
    }
    monitor.announce(notifier);
}

/// Poll through `read` and `waiting` forever, once per poll interval, starting at
/// once.
///
/// Split from [`spawn_capacity_monitor`] so the loop runs against scripted
/// sources on a paused clock.
pub async fn run_capacity_monitor<R, F, W, G>(
    monitor: CapacityMonitor,
    notifier: Notifier,
    mut read: R,
    mut waiting: W,
) where
    R: FnMut() -> F,
    F: Future<Output = Result<StoreCapacity, CapacityReadError>>,
    W: FnMut() -> G,
    G: Future<Output = Option<WaitingRuns>>,
{
    let interval = monitor.settings().poll_interval;
    loop {
        poll_once(&monitor, &notifier, &mut read, &mut waiting).await;
        tokio::time::sleep(interval).await;
    }
}

/// Count the runs waiting to store their trees from the job table. `None` when the
/// table could not be read, which leaves the monitor's last count in place.
pub async fn waiting_runs(db: &crate::db::Db) -> Option<WaitingRuns> {
    match db.storing_jobs().await {
        Ok(waiting) => Some(waiting),
        Err(err) => {
            tracing::warn!(error = %err, "could not count the runs waiting to store their artifacts");
            None
        }
    }
}

/// Build the monitor for a configuration and, when an artifact service is
/// configured, take its first reading and spawn the loop that keeps it current.
///
/// The first reading is taken here, before this returns, so the backend never
/// holds a queue it has no reason to: a store with room is known to have it by the
/// first claim. A service that does not answer costs startup one read timeout and
/// leaves the monitor unavailable with the queue on hold until a poll gets a
/// reading.
///
/// With no in-cluster artifact URL or no service token there is no service to
/// read, so the monitor is [unmonitored](CapacityMonitor::unmonitored) and no task
/// is spawned: a single-box development setup holds nothing. The returned handle is
/// the loop's task, which runs until it is aborted or the runtime shuts down;
/// dropping the handle detaches it.
pub async fn spawn_capacity_monitor(
    settings: CapacitySettings,
    http: reqwest::Client,
    artifacts_url: Option<String>,
    service_token: Option<String>,
    notifier: Notifier,
    db: Arc<crate::db::Db>,
) -> (CapacityMonitor, Option<tokio::task::JoinHandle<()>>) {
    let (Some(base), Some(token)) = (artifacts_url, service_token) else {
        return (CapacityMonitor::unmonitored(settings), None);
    };
    let monitor = CapacityMonitor::watching(settings);
    // The memory of a failed upload died with the previous process. The one trace
    // it left is the last finished run's recorded presence.
    match db.latest_finished_tree_stored().await {
        Ok(Some(false)) => {
            monitor.restore_unproven("the most recently finished run's tree was not stored");
        }
        Ok(_) => {}
        Err(err) => {
            tracing::warn!(error = %err, "could not read whether the last finished run's tree was stored");
        }
    }
    let mut read = move || {
        let (http, base, token) = (http.clone(), base.clone(), token.clone());
        async move { read_capacity(&http, &base, &token).await }
    };
    let mut waiting = move || {
        let db = Arc::clone(&db);
        async move { waiting_runs(&db).await }
    };
    poll_once(&monitor, &notifier, &mut read, &mut waiting).await;
    let task = tokio::spawn({
        let monitor = monitor.clone();
        async move {
            tokio::time::sleep(monitor.settings().poll_interval).await;
            run_capacity_monitor(monitor, notifier, read, waiting).await;
        }
    });
    (monitor, Some(task))
}

#[cfg(test)]
#[path = "capacity.test.rs"]
mod tests;

#[cfg(test)]
#[path = "capacity.hold.test.rs"]
mod hold_tests;

#[cfg(test)]
#[path = "capacity.publish.test.rs"]
mod publish_tests;
