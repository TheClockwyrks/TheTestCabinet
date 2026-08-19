//! The top-up scheduler: which cells to launch, and how many runs each, to refill
//! a coverage plan's (or a ladder's) review buffer.
//!
//! A plan holds a *review buffer* rather than a queue: the point is to keep a
//! bounded number of runs waiting on the reviewer, not to enqueue every run the
//! plan is missing the moment it is saved. Firing the whole matrix at once spends
//! the entire budget before a single run has been looked at — and the first review
//! is usually what tells you the plan was wrong.
//!
//! The algorithm the console calls into is:
//!
//! 1. Walk the cells in the order the caller passes them — that order *is* the
//!    plan's configured outer axis (one case at a time, or one model at a time),
//!    and because `job.queue_seq` is monotonic and the dispatcher claims in
//!    ascending order, emission order is execution order.
//! 2. Skip cells already at their per-cell target, counted **globally**.
//! 3. **Defer** cells whose harness is already at its parallelism cap — see
//!    [below](#harness-parallelism-comes-first).
//! 4. Emit **whole** cells — all of a cell's missing repeats together — until the
//!    outstanding total reaches the buffer target.
//! 5. Then make a second pass over the deferred cells, in their original order,
//!    emitting until the buffer target is reached.
//!
//! Step 4 deliberately overshoots by up to one cell. A cell's repeats are the unit
//! of judgement: five runs of one case on one model are reviewed against each
//! other, so splitting them across two top-ups (and therefore across whatever
//! else the queue picked up in between) is worse than briefly running the buffer
//! over its target.
//!
//! ## Harness parallelism comes first
//!
//! The buffer bounds *reviewer* backlog, but the thing that produces the backlog is
//! the queue, and the queue will not start a run whose harness is already at its
//! maximum parallelism (`harness_config.max_parallelism`). Ignoring that cap while
//! filling the buffer is how a plan starves itself: walking the cells in plain order
//! spends the whole buffer on the first harness it meets, and if that harness is
//! capped at two, ten queued runs still produce two at a time while every other
//! harness in the plan sits idle. The reviewer then drains the buffer faster than a
//! deliberately-throttled harness can refill it, and the buffer — whose entire job is
//! to keep them fed — is the thing holding the machine back.
//!
//! So the first pass gives every harness with a free slot some work before any
//! harness is queued deeper than it can run. Within a harness the caller's order is
//! untouched; only the interleaving across harnesses changes, and the dispatcher
//! already reorders exactly that way when it skips a capped job to claim a later
//! claimable one.
//!
//! The second pass then fills whatever buffer is left over with the deferred cells,
//! so a plan whose harnesses are *all* capped still queues real depth ahead of the
//! reviewer. That matters because top-up is an endpoint the console calls and not a
//! daemon: a plan left with only as many runs as can execute at once would stop dead
//! the moment the reviewer stopped submitting reviews.
//!
//! Nothing here reads the database. The caller gathers the counts, and the caller
//! owns serializing the top-up per plan/ladder — this function is pure, so two
//! concurrent callers observing the same shortfall would each happily return the
//! same launches.

/// One cell's demand: how many runs it wants, how many exist, and how many of
/// them are occupying a slot in the requesting account's review buffer.
///
/// A "cell" here is whatever unit the caller is topping up — a plan's
/// `case × combination` cell, or a ladder rung's current combination. This core
/// never learns which; [`CellLaunch`] refers back by position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellDemand {
    /// The target number of runs for this cell (the plan's runs-per-cell, or a
    /// rung's per-rung override).
    pub target: u32,
    /// Completed runs for this cell, counted **globally** — every run of the cell
    /// regardless of which account launched it. A run someone else produced still
    /// satisfies the target, so it is never re-requested.
    pub completed: u32,
    /// In-flight jobs for this cell (`queued`/`pending`/`dispatched`/`starting`/
    /// `running`), counted **globally** for the same reason as [`Self::completed`].
    /// `pending` is included: a game jam's jobs are serialized per model by the
    /// queue and legitimately sit there, and they are every bit as much "already
    /// coming" as a `queued` one.
    pub in_flight: u32,
    /// How many of [`Self::completed`] the **requesting account** has not reviewed.
    /// This is the only per-account number in the struct, and it never changes what
    /// the cell needs — it only occupies buffer slots (see [`Self::outstanding`]),
    /// which is what stops a plan racing ahead of the person reviewing it.
    ///
    /// Callers should leave out runs the gate can judge without a review — a run
    /// whose build never loaded is decided by the ladder without a reviewer, so it
    /// must not hold a slot.
    pub unreviewed: u32,
    /// Which harness this cell's runs would occupy, as an index into the
    /// `harnesses` slice passed to [`top_up`]. Cells of the same harness must share
    /// an index — that shared entry is how the scheduler knows a second cell would
    /// queue behind the first. An index with no entry in the slice is treated as an
    /// uncapped harness.
    pub harness: usize,
}

impl CellDemand {
    /// How many runs this cell is still missing: its target less everything that
    /// already exists or is coming. Saturating, so a cell that overshot its target
    /// (a hand-launched extra run) reports `0` rather than wrapping.
    pub fn missing(&self) -> u32 {
        self.target
            .saturating_sub(self.completed.saturating_add(self.in_flight))
    }

    /// How many of this cell's runs occupy a slot in the requester's review
    /// buffer: everything in flight, plus everything finished that they have not
    /// judged yet. Both are work the reviewer still owes attention to, which is
    /// exactly what the buffer bounds.
    pub fn outstanding(&self) -> u32 {
        self.in_flight.saturating_add(self.unreviewed)
    }
}

/// How much room one harness has to *start* another run right now.
///
/// The queue enforces a harness's configured maximum parallelism at claim time, so a
/// run enqueued for a harness that is already at its cap does not start — it waits in
/// `pending` behind the ones ahead of it. The scheduler reads this to spend the review
/// buffer on work that can actually move first; see the
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

/// One entry of a top-up decision: launch `runs` more runs of the cell at index
/// `cell` in the slice that was passed to [`top_up`].
///
/// The index — rather than the cell itself — keeps this core ignorant of the wire
/// types a plan and a ladder describe their cells with, so both can share it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellLaunch {
    /// The position of the cell in the `cells` slice passed to [`top_up`].
    pub cell: usize,
    /// How many runs to enqueue for it. Always the cell's whole shortfall — never
    /// a partial cell — and never zero.
    pub runs: u32,
}

/// The total outstanding across `cells`: the number of runs the requesting account
/// is already on the hook to review, in flight or finished-but-unjudged.
///
/// This is the canonical way to compute the `outstanding` argument to [`top_up`];
/// it is a separate function only so a caller that has already tallied the number
/// some other way (or across a wider set than the cells it is about to walk) can
/// pass its own.
pub fn outstanding_across(cells: &[CellDemand]) -> u32 {
    cells
        .iter()
        .fold(0u32, |total, cell| total.saturating_add(cell.outstanding()))
}

/// Decide the next top-up: the ordered cells to launch and how many runs each,
/// given the harnesses' free capacity, the buffer target, and how much is already
/// outstanding.
///
/// `cells` must already be in the caller's intended execution order (the plan's
/// or ladder's outer axis). The returned launches keep that order *within* a
/// harness, but a cell whose harness is at its parallelism cap is deferred behind
/// the cells that can start now — see the
/// [module docs](self#harness-parallelism-comes-first).
///
/// `harnesses` is indexed by [`CellDemand::harness`]; an index it does not cover is
/// treated as uncapped, so a caller with no cap information at all may pass `&[]`
/// and get the plain in-order walk.
///
/// `outstanding` is the requester's current buffer occupancy — normally
/// [`outstanding_across`] over these same cells. Returning an empty vector means
/// there is nothing to do: either the buffer is full or every cell is satisfied.
///
/// Idempotent by construction: it holds no state, so calling it again after the
/// launches it returned have been enqueued (and therefore counted into
/// `in_flight`) yields the next slice of work, not the same one twice.
pub fn top_up(
    cells: &[CellDemand],
    harnesses: &[HarnessCapacity],
    buffer_target: u32,
    outstanding: u32,
) -> Vec<CellLaunch> {
    let mut launches = Vec::new();
    let mut launched = vec![false; cells.len()];
    // A local copy, because emitting a cell fills its harness's slots for the rest
    // of this decision just as surely as an already-queued job does.
    let mut capacity = harnesses.to_vec();
    let mut outstanding = outstanding;

    // Pass one takes only cells that can start now; pass two picks up whatever it
    // deferred, so the buffer still ends up as deep as it was asked to be.
    for runnable_only in [true, false] {
        for (cell, demand) in cells.iter().enumerate() {
            // The buffer check comes *before* emitting, never after: a cell is emitted
            // whole once we decide to emit it at all, so the only place the total can be
            // held down is at the boundary between cells.
            if outstanding >= buffer_target {
                break;
            }
            if launched[cell] {
                continue;
            }
            let runs = demand.missing();
            // A satisfied cell costs nothing and consumes no buffer — skip it and keep
            // looking rather than stopping, so one finished case does not stall the
            // cases behind it.
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
            outstanding = outstanding.saturating_add(runs);
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
