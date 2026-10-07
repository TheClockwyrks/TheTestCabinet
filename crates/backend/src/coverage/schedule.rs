//! The launch-pass scheduler: which cells to launch, and how many runs each, to keep a
//! coverage plan or a ladder dispatch filling under its runs-in-flight limit.
//!
//! A plan or a ladder never fires its whole shortfall at once by default. It keeps at
//! most _N_ of its **own** jobs in flight — queued through running — so it shares the
//! global FIFO queue fairly with everything else waiting on it. Completed runs never
//! occupy the limit, reviewed or not: reviews are labels added after the fact and never
//! meter a launch.
//!
//! That bound is an [`InFlightLimit`], and it has an explicit
//! [unbounded](InFlightLimit::Unbounded) shape for the owner who wants every missing run
//! queued at once. It is a real variant rather than a large number so that "launch
//! everything" is an instruction the owner can give, read back, and be shown.
//!
//! The algorithm a launch pass runs is:
//!
//! 1. Walk the cells in the order the caller passes them — that order *is* the plan's or
//!    ladder's configured outer axis, and because `job.queue_seq` is monotonic and the
//!    dispatcher claims in ascending order, emission order is execution order.
//! 2. Skip cells already at their target, counting what exists and what is coming.
//! 3. **Defer** cells whose harness is already at its parallelism cap — see
//!    [below](#harness-parallelism-comes-first).
//! 4. Emit **whole** cells — all of a cell's missing repeats together — until the owner's
//!    jobs in flight reach the limit (an unbounded limit is never reached, so every
//!    missing cell is emitted).
//! 5. Then make a second pass over the deferred cells, in their original order, emitting
//!    until the limit is reached.
//!
//! Step 4 deliberately overshoots by up to one cell. A cell's repeats are compared
//! against each other, so splitting them across two passes (and therefore across
//! whatever else the queue picked up in between) is worse than briefly running over the
//! limit.
//!
//! ## Harness parallelism comes first
//!
//! The queue will not start a run whose harness is already at its maximum parallelism
//! (`harness_config.max_parallelism`). Ignoring that cap while filling the limit is how a
//! plan starves itself: walking the cells in plain order spends the whole limit on the
//! first harness it meets, and if that harness is capped at two, ten queued runs still
//! produce two at a time while every other harness in the plan sits idle.
//!
//! So the first pass gives every harness with a free slot some work before any harness is
//! queued deeper than it can run. Within a harness the caller's order is untouched; only
//! the interleaving across harnesses changes, and the dispatcher already reorders exactly
//! that way when it skips a capped job to claim a later claimable one. The second pass
//! then fills whatever room is left with the deferred cells, so a plan whose harnesses
//! are *all* capped still queues real depth.
//!
//! Nothing here reads the database. The caller gathers the counts, and the caller owns
//! serializing passes per plan or ladder — this function is pure, so two concurrent
//! callers observing the same shortfall would each happily return the same launches.

use serde::{Deserialize, Serialize};

/// How many of a plan's or a ladder dispatch's own jobs may be in flight at once before a
/// launch pass stops emitting — or no bound at all.
///
/// The unbounded shape is its own variant rather than a large bound so that it is
/// stored, reported, and shown as the instruction it is, and so that no bound the owner
/// types can be mistaken for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum InFlightLimit {
    /// Keep at most `runs` jobs in flight. `0` is a legitimate bound — "launch nothing"
    /// — and is not the same instruction as no bound.
    Bounded {
        /// The most jobs that may be in flight before a launch pass stops.
        runs: u32,
    },
    /// No bound: a launch pass emits every missing cell it can. The per-cell target and
    /// the harness parallelism cap still apply.
    Unbounded,
}

impl InFlightLimit {
    /// Whether `in_flight` jobs already fill this limit, so a launch pass must stop
    /// before emitting another cell. An unbounded limit is never full.
    pub fn is_full(self, in_flight: u32) -> bool {
        match self {
            InFlightLimit::Bounded { runs } => in_flight >= runs,
            InFlightLimit::Unbounded => false,
        }
    }

    /// The bound, or `None` when there is none. For callers that want to show or
    /// compare the number without matching on the shape.
    pub fn bound(self) -> Option<u32> {
        match self {
            InFlightLimit::Bounded { runs } => Some(runs),
            InFlightLimit::Unbounded => None,
        }
    }
}

/// One cell's demand: how many runs it wants, how many already count, and how many are
/// coming.
///
/// A "cell" here is whatever unit the caller is launching — a plan's
/// `case × combination` cell, or a ladder climber's current rung. This core never learns
/// which; [`CellLaunch`] refers back by position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellDemand {
    /// The target number of runs for this cell (the plan's runs-per-cell, or a rung's
    /// target).
    pub target: u32,
    /// Finished runs of this cell that count: completed runs and the model's own
    /// failures, an automatically retried attempt counted once with its retry. A plan
    /// counts them globally; a ladder dispatch counts only its own.
    pub counted: u32,
    /// In-flight jobs for this cell (`queued`/`pending`/`dispatched`/`starting`/
    /// `running`), counted the same way as [`Self::counted`]. `pending` is included: a
    /// game jam's jobs are serialized per model by the queue and legitimately sit there,
    /// and they are every bit as much "already coming" as a `queued` one.
    pub in_flight: u32,
    /// Which harness this cell's runs would occupy, as an index into the `harnesses`
    /// slice passed to [`launch_pass`]. Cells of the same harness must share an index —
    /// that shared entry is how the scheduler knows a second cell would queue behind the
    /// first. An index with no entry in the slice is treated as an uncapped harness.
    pub harness: usize,
}

impl CellDemand {
    /// How many runs this cell is still missing: its target less everything that
    /// already counts or is coming. Saturating, so a cell that overshot its target (a
    /// hand-launched extra run) reports `0` rather than wrapping.
    pub fn missing(&self) -> u32 {
        self.target
            .saturating_sub(self.counted.saturating_add(self.in_flight))
    }
}

/// How much room one harness has to *start* another run right now.
///
/// The queue enforces a harness's configured maximum parallelism at claim time, so a
/// run enqueued for a harness that is already at its cap does not start — it waits in
/// `pending` behind the ones ahead of it. The scheduler reads this to spend the limit on
/// work that can actually move first; see the
/// [module docs](self#harness-parallelism-comes-first).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HarnessCapacity {
    /// Jobs of this harness already in flight, counted **globally** across every
    /// plan, ladder, and hand-launched run.
    ///
    /// This is the wider `queued`/`pending`/`dispatched`/`starting`/`running` set
    /// rather than the narrower one the cap is enforced over, because a job merely
    /// queued for this harness still consumes the cap before anything enqueued after
    /// it: what the scheduler is asking is "would one more run start soon", not "is a
    /// slot free this instant".
    pub in_flight: u32,
    /// The harness's configured maximum parallelism, or `None` when it is unlimited
    /// (the default — most harnesses have no `harness_config` row at all).
    pub max_parallel: Option<u32>,
}

impl HarnessCapacity {
    /// A harness with no configured cap and nothing in flight — the shape every
    /// harness has until an operator throttles it.
    pub const UNLIMITED: Self = Self {
        in_flight: 0,
        max_parallel: None,
    };

    /// Whether a run enqueued for this harness now would be claimable rather than
    /// held back behind the cap. An unlimited harness always has room.
    fn has_room(&self) -> bool {
        self.max_parallel.is_none_or(|max| self.in_flight < max)
    }
}

/// One entry of a launch decision: launch `runs` more runs of the cell at index `cell` in
/// the slice that was passed to [`launch_pass`].
///
/// The index — rather than the cell itself — keeps this core ignorant of the wire
/// types a plan and a ladder describe their cells with, so both can share it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellLaunch {
    /// The position of the cell in the `cells` slice passed to [`launch_pass`].
    pub cell: usize,
    /// How many runs to enqueue for it. Always the cell's whole shortfall — never
    /// a partial cell — and never zero.
    pub runs: u32,
}

/// Decide the next launches: the ordered cells to launch and how many runs each, given
/// the harnesses' free capacity, the runs-in-flight limit, and how many of the owner's
/// jobs are already in flight.
///
/// `cells` must already be in the caller's intended execution order (the plan's or
/// ladder's outer axis). The returned launches keep that order *within* a harness, but a
/// cell whose harness is at its parallelism cap is deferred behind the cells that can
/// start now — see the [module docs](self#harness-parallelism-comes-first).
///
/// `harnesses` is indexed by [`CellDemand::harness`]; an index it does not cover is
/// treated as uncapped, so a caller with no cap information at all may pass `&[]` and
/// get the plain in-order walk.
///
/// `in_flight` is the owner's own jobs in flight — every job whose origin names the plan
/// or the dispatch, across every cell, not only the cells passed here. Returning an empty
/// vector means there is nothing to do: either the limit is full or every cell is
/// satisfied. An [unbounded](InFlightLimit::Unbounded) limit is never full, so the walk
/// emits every missing cell and only the second reason remains.
///
/// Idempotent by construction: it holds no state, so calling it again after the launches
/// it returned have been enqueued (and therefore counted into `in_flight`) yields the next
/// slice of work, not the same one twice.
pub fn launch_pass(
    cells: &[CellDemand],
    harnesses: &[HarnessCapacity],
    limit: InFlightLimit,
    in_flight: u32,
) -> Vec<CellLaunch> {
    let mut launches = Vec::new();
    let mut launched = vec![false; cells.len()];
    // A local copy, because emitting a cell fills its harness's slots for the rest
    // of this decision just as surely as an already-queued job does.
    let mut capacity = harnesses.to_vec();
    let mut in_flight = in_flight;

    // Pass one takes only cells that can start now; pass two picks up whatever it
    // deferred, so the queue still ends up as deep as the limit allows.
    for runnable_only in [true, false] {
        for (cell, demand) in cells.iter().enumerate() {
            // The limit check comes *before* emitting, never after: a cell is emitted
            // whole once we decide to emit it at all, so the only place the total can be
            // held down is at the boundary between cells.
            if limit.is_full(in_flight) {
                break;
            }
            if launched[cell] {
                continue;
            }
            let runs = demand.missing();
            // A satisfied cell costs nothing and takes no room — skip it and keep looking
            // rather than stopping, so one finished case does not stall the cases behind
            // it.
            if runs == 0 {
                continue;
            }
            let has_room = capacity
                .get(demand.harness)
                .is_none_or(HarnessCapacity::has_room);
            if runnable_only && !has_room {
                continue;
            }
            launched[cell] = true;
            launches.push(CellLaunch { cell, runs });
            in_flight = in_flight.saturating_add(runs);
            if let Some(harness) = capacity.get_mut(demand.harness) {
                harness.in_flight = harness.in_flight.saturating_add(runs);
            }
        }
    }
    launches
}

#[cfg(test)]
#[path = "schedule.test.rs"]
mod tests;
