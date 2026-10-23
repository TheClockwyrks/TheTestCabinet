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
//! 3. Skip cells whose harness has no free slot under its parallelism cap — see
//!    [below](#harness-parallelism-comes-first).
//! 4. Emit each remaining cell's missing repeats until the owner's jobs in flight reach
//!    the limit (an unbounded limit is never reached). A cell on an uncapped harness is
//!    emitted **whole**; a cell on a capped harness is emitted up to that harness's free
//!    slots, and the rest of it waits for a later pass.
//!
//! Step 4 deliberately overshoots by up to one cell. A cell's repeats are compared
//! against each other, so splitting them across two passes (and therefore across
//! whatever else the queue picked up in between) is worse than briefly running over the
//! limit. A capped harness splits them regardless: it runs no more of them at once than
//! its cap allows, so queueing the rest early would only hold them `pending`.
//!
//! ## Harness parallelism comes first
//!
//! The queue will not start a run whose harness is already at its maximum parallelism
//! (`harness_config.max_parallelism`). A run enqueued beyond that cap waits in `pending`,
//! but it still holds a place under its owner's limit. Queueing a capped harness deeper
//! than its cap is therefore how a plan starves itself: if that harness is capped at two,
//! ten queued runs still produce two at a time while the limit they occupy keeps every
//! other harness in the plan idle.
//!
//! So a capped harness is only ever given as many runs as it has free slots, and each
//! emitted run takes one. Its cells that find no slot are left for the launch pass a
//! freed slot triggers, and the cells behind them on other harnesses take their place in
//! the limit. Within a harness the caller's order is untouched; only the interleaving
//! across harnesses changes, and the dispatcher already reorders exactly that way when it
//! skips a capped job to claim a later claimable one.
//!
//! Nothing here reads the database. The caller gathers the counts, and the caller owns
//! serializing passes per plan or ladder — this function is pure, so two concurrent
//! callers observing the same shortfall would each happily return the same launches.

pub use test_cabinet_contracts::backend_api::coverage::InFlightLimit;

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
    /// Whether the queue runs this cell's runs one at a time: a game jam, whose entries by
    /// one model are driven in turn. Such a cell takes at most one of its harness's slots
    /// however many of its runs are queued, and none while one of them is already in
    /// flight, since that run already holds the slot its successors will take.
    pub serialized: bool,
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

    /// How many more runs enqueued for this harness now would be claimable rather than
    /// held back behind the cap, or `None` for an unlimited harness, which always has
    /// room.
    fn free_slots(&self) -> Option<u32> {
        self.max_parallel
            .map(|max| max.saturating_sub(self.in_flight))
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
    /// How many runs to enqueue for it. Never zero. The cell's whole shortfall on an
    /// uncapped harness; on a capped one, at most the harness's free slots.
    pub runs: u32,
}

/// Decide the next launches: the ordered cells to launch and how many runs each, given
/// the harnesses' free capacity, the runs-in-flight limit, and how many of the owner's
/// jobs are already in flight.
///
/// `cells` must already be in the caller's intended execution order (the plan's or
/// ladder's outer axis). The returned launches keep that order, but a capped harness is
/// given no more runs than it has free slots, so a cell whose harness is full is left
/// out and a cell whose harness is nearly full is launched in part — see the
/// [module docs](self#harness-parallelism-comes-first).
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
    // A local copy, because emitting a run fills its harness's slot for the rest of
    // this decision just as surely as an already-queued job does.
    let mut capacity = harnesses.to_vec();
    let mut in_flight = in_flight;

    for (cell, demand) in cells.iter().enumerate() {
        // The limit check comes *before* emitting, never after: a cell is emitted as far
        // as it goes once we decide to emit it at all, so the only place the total can be
        // held down is at the boundary between cells.
        if limit.is_full(in_flight) {
            break;
        }
        // A satisfied cell costs nothing and takes no room — skip it and keep looking
        // rather than stopping, so one finished case does not stall the cases behind it.
        // A cell whose harness is full is skipped the same way, so the cells behind it on
        // other harnesses get the room it would have wasted.
        let free = capacity
            .get(demand.harness)
            .and_then(HarnessCapacity::free_slots);
        let runs = free.map_or(demand.missing(), |free| demand.missing().min(free));
        if runs == 0 {
            continue;
        }
        launches.push(CellLaunch { cell, runs });
        in_flight = in_flight.saturating_add(runs);
        let takes = match (demand.serialized, demand.in_flight) {
            (false, _) => runs,
            (true, 0) => 1,
            (true, _) => 0,
        };
        if let Some(harness) = capacity.get_mut(demand.harness) {
            harness.in_flight = harness.in_flight.saturating_add(takes);
        }
    }
    launches
}

#[cfg(test)]
#[path = "schedule.test.rs"]
mod tests;
