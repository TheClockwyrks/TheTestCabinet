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
//! 3. Emit **whole** cells — all of a cell's missing repeats together — until the
//!    outstanding total reaches the buffer target.
//! 4. Stop.
//!
//! Step 3 deliberately overshoots by up to one cell. A cell's repeats are the unit
//! of judgement: five runs of one case on one model are reviewed against each
//! other, so splitting them across two top-ups (and therefore across whatever
//! else the queue picked up in between) is worse than briefly running the buffer
//! over its target.
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
/// given the buffer target and how much is already outstanding.
///
/// `cells` must already be in the caller's intended execution order (the plan's
/// or ladder's outer axis); this walks it front to back and the returned launches
/// keep that order, because the order runs are enqueued in is the order they will
/// execute and therefore the order they will be reviewed in.
///
/// `outstanding` is the requester's current buffer occupancy — normally
/// [`outstanding_across`] over these same cells. Returning an empty vector means
/// there is nothing to do: either the buffer is full or every cell is satisfied.
///
/// Idempotent by construction: it holds no state, so calling it again after the
/// launches it returned have been enqueued (and therefore counted into
/// `in_flight`) yields the next slice of work, not the same one twice.
pub fn top_up(cells: &[CellDemand], buffer_target: u32, outstanding: u32) -> Vec<CellLaunch> {
    let mut launches = Vec::new();
    let mut outstanding = outstanding;
    for (cell, demand) in cells.iter().enumerate() {
        // The buffer check comes *before* emitting, never after: a cell is emitted
        // whole once we decide to emit it at all, so the only place the total can be
        // held down is at the boundary between cells.
        if outstanding >= buffer_target {
            break;
        }
        let runs = demand.missing();
        // A satisfied cell costs nothing and consumes no buffer — skip it and keep
        // looking rather than stopping, so one finished case does not stall the
        // cases behind it.
        if runs == 0 {
            continue;
        }
        launches.push(CellLaunch { cell, runs });
        outstanding = outstanding.saturating_add(runs);
    }
    launches
}

#[cfg(test)]
#[path = "schedule.test.rs"]
mod tests;
