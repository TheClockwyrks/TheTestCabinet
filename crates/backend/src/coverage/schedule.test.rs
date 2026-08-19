use super::*;

/// A cell wanting `target` runs, with `completed` finished and `in_flight`
/// coming, none of them awaiting the requester's review. On harness lane 0 — the
/// only lane that matters when the test passes no capacities.
fn cell(target: u32, completed: u32, in_flight: u32) -> CellDemand {
    on_harness(0, target, completed, in_flight)
}

/// The same, on an explicit harness lane.
fn on_harness(harness: usize, target: u32, completed: u32, in_flight: u32) -> CellDemand {
    CellDemand {
        target,
        completed,
        in_flight,
        unreviewed: 0,
        harness,
    }
}

/// The same, with `unreviewed` of the completed runs not yet judged by the
/// requesting account.
fn unreviewed_cell(target: u32, completed: u32, in_flight: u32, unreviewed: u32) -> CellDemand {
    CellDemand {
        target,
        completed,
        in_flight,
        unreviewed,
        harness: 0,
    }
}

/// A harness throttled to `max_parallel` concurrent runs, with `in_flight` of them
/// already queued or running globally.
fn capped(in_flight: u32, max_parallel: u32) -> HarnessCapacity {
    HarnessCapacity {
        in_flight,
        max_parallel: Some(max_parallel),
    }
}

/// Flatten a decision into `(cell index, runs)` pairs for terse assertions.
fn pairs(launches: &[CellLaunch]) -> Vec<(usize, u32)> {
    launches.iter().map(|l| (l.cell, l.runs)).collect()
}

#[test]
fn an_empty_plan_launches_nothing() {
    assert!(top_up(&[], &[], 10, 0).is_empty());
    assert_eq!(outstanding_across(&[]), 0);
}

#[test]
fn a_fully_satisfied_plan_launches_nothing() {
    // Every cell is at its target globally, so there is no work regardless of how
    // much room the buffer has.
    let cells = [cell(5, 5, 0), cell(5, 3, 2), cell(5, 6, 0)];
    assert!(top_up(&cells, &[], 50, 0).is_empty());
}

#[test]
fn a_full_buffer_launches_nothing_even_with_work_outstanding() {
    let cells = [cell(5, 0, 0), cell(5, 0, 0)];
    // Outstanding is already at the target: the reviewer has all they can hold.
    assert!(top_up(&cells, &[], 4, 4).is_empty());
    // And past it — a previous top-up's deliberate overshoot.
    assert!(top_up(&cells, &[], 4, 7).is_empty());
}

#[test]
fn a_cell_is_emitted_whole_never_split_to_fit_the_buffer() {
    // The buffer has room for three but the first cell is missing five. It is
    // emitted whole: a case's repeats are reviewed against each other, so they
    // must land in the queue together.
    let cells = [cell(5, 0, 0), cell(5, 0, 0)];
    assert_eq!(pairs(&top_up(&cells, &[], 3, 0)), vec![(0, 5)]);
}

#[test]
fn the_overshoot_is_bounded_to_one_cell() {
    // Buffer of 6, cells of 5: the first takes it to 5 (under target, so the
    // second is emitted too) and the second overshoots to 10. The third is not
    // reached — the overshoot never compounds.
    let cells = [cell(5, 0, 0), cell(5, 0, 0), cell(5, 0, 0)];
    assert_eq!(pairs(&top_up(&cells, &[], 6, 0)), vec![(0, 5), (1, 5)]);
}

#[test]
fn launching_stops_exactly_at_the_buffer_target() {
    // Cells of 2 against a buffer of 6 divide evenly, so there is no overshoot and
    // the fourth cell is left for the next top-up.
    let cells = [cell(2, 0, 0), cell(2, 0, 0), cell(2, 0, 0), cell(2, 0, 0)];
    assert_eq!(
        pairs(&top_up(&cells, &[], 6, 0)),
        vec![(0, 2), (1, 2), (2, 2)]
    );
}

#[test]
fn a_satisfied_cell_is_skipped_without_stalling_the_ones_behind_it() {
    // The middle cell is done; the walk continues past it rather than stopping.
    let cells = [cell(2, 2, 0), cell(2, 0, 0), cell(2, 1, 0)];
    assert_eq!(pairs(&top_up(&cells, &[], 10, 0)), vec![(1, 2), (2, 1)]);
}

#[test]
fn cells_are_launched_in_the_order_they_were_passed() {
    // The caller's slice order *is* the configured outer axis, and enqueue order is
    // execution order, so the decision must never reorder it.
    let cells = [cell(1, 0, 0), cell(1, 0, 0), cell(1, 0, 0)];
    assert_eq!(
        pairs(&top_up(&cells, &[], 3, 0)),
        vec![(0, 1), (1, 1), (2, 1)]
    );
}

#[test]
fn in_flight_jobs_count_toward_a_cell_target() {
    // Three of five are already coming, so only the shortfall of two is launched.
    let cells = [cell(5, 0, 3)];
    assert_eq!(pairs(&top_up(&cells, &[], 10, 3)), vec![(0, 2)]);
}

#[test]
fn a_cell_past_its_target_reports_no_shortfall() {
    // Hand-launched extras took the cell past its target; the subtraction saturates
    // rather than wrapping into a huge launch.
    let overshot = cell(3, 5, 1);
    assert_eq!(overshot.missing(), 0);
    assert!(top_up(&[overshot], &[], 10, 0).is_empty());
}

#[test]
fn a_cell_satisfied_by_runs_the_requester_has_not_reviewed_launches_nothing() {
    // The cell is at its target globally — someone produced the runs — but the
    // requester has judged none of them. Counts are global, so nothing is
    // relaunched; judgement is per-account, so all five hold buffer slots.
    let cells = [unreviewed_cell(5, 5, 0, 5), cell(5, 0, 0)];
    assert_eq!(cells[0].missing(), 0);
    assert_eq!(outstanding_across(&cells), 5);

    // With those five counted, a buffer of 5 is already full: the second cell waits
    // until the requester works through them.
    assert!(top_up(&cells, &[], 5, outstanding_across(&cells)).is_empty());
    // Raise the buffer and the second cell is reached, the satisfied one still
    // contributing nothing to launch.
    assert_eq!(
        pairs(&top_up(&cells, &[], 8, outstanding_across(&cells))),
        vec![(1, 5)]
    );
}

#[test]
fn outstanding_counts_in_flight_and_unjudged_across_every_cell() {
    let cells = [
        unreviewed_cell(5, 3, 2, 1),
        unreviewed_cell(5, 5, 0, 4),
        cell(5, 5, 0),
    ];
    // (2 in flight + 1 unjudged) + (0 + 4) + (0 + 0).
    assert_eq!(outstanding_across(&cells), 7);
}

#[test]
fn a_zero_buffer_target_launches_nothing() {
    // A paused-by-buffer plan: the console can wind the buffer to zero to stop
    // topping up without touching the queue.
    let cells = [cell(5, 0, 0)];
    assert!(top_up(&cells, &[], 0, 0).is_empty());
}

#[test]
fn repeating_a_top_up_after_enqueueing_moves_to_the_next_cells() {
    // Idempotence in the way that matters: once the first decision's launches are
    // in flight, re-running the algorithm returns the *next* slice of work, never
    // the same one again.
    let before = [cell(5, 0, 0), cell(5, 0, 0), cell(5, 0, 0)];
    let first = top_up(&before, &[], 5, outstanding_across(&before));
    assert_eq!(pairs(&first), vec![(0, 5)]);

    let after = [cell(5, 0, 5), cell(5, 0, 0), cell(5, 0, 0)];
    // The five are still outstanding, so the buffer stays full and nothing is added.
    assert!(top_up(&after, &[], 5, outstanding_across(&after)).is_empty());

    // Once they complete and are reviewed, the buffer empties and cell 1 is next.
    let reviewed = [cell(5, 5, 0), cell(5, 0, 0), cell(5, 0, 0)];
    assert_eq!(
        pairs(&top_up(&reviewed, &[], 5, outstanding_across(&reviewed))),
        vec![(1, 5)]
    );
}

#[test]
fn an_unlimited_harness_never_defers_a_cell() {
    // Capacities are supplied, but nothing is throttled: the walk is the plain
    // in-order one, exactly as when the caller passes none at all.
    let cells = [on_harness(0, 2, 0, 0), on_harness(1, 2, 0, 0)];
    let harnesses = [HarnessCapacity::UNLIMITED, HarnessCapacity::UNLIMITED];
    assert_eq!(
        pairs(&top_up(&cells, &harnesses, 10, 0)),
        vec![(0, 2), (1, 2)]
    );
}

#[test]
fn a_throttled_harness_does_not_spend_the_whole_buffer_before_an_idle_one() {
    // The reported bug: every early cell belongs to a harness capped at two, so a
    // plain in-order walk would queue the whole buffer behind it and leave the
    // second harness — which could start immediately — with nothing.
    let cells = [
        on_harness(0, 2, 0, 0),
        on_harness(0, 2, 0, 0),
        on_harness(0, 2, 0, 0),
        on_harness(1, 2, 0, 0),
        on_harness(1, 2, 0, 0),
    ];
    let harnesses = [capped(0, 2), HarnessCapacity::UNLIMITED];
    // Cell 0 fills the throttled harness's two slots, so its siblings are deferred
    // and the idle harness is fed first; the deferred cells then take the buffer
    // that is left, in their original order.
    assert_eq!(
        pairs(&top_up(&cells, &harnesses, 10, 0)),
        vec![(0, 2), (3, 2), (4, 2), (1, 2), (2, 2)]
    );
}

#[test]
fn a_harness_already_at_its_cap_is_deferred_from_the_first_pass() {
    // The steady state of the same bug: the throttled harness's earlier runs are
    // still working through the queue, so nothing more of it can start. The other
    // harness's cells go first even though they come later in the plan's order.
    let cells = [on_harness(0, 3, 0, 0), on_harness(1, 3, 0, 0)];
    let harnesses = [capped(4, 2), HarnessCapacity::UNLIMITED];
    assert_eq!(
        pairs(&top_up(&cells, &harnesses, 10, 0)),
        vec![(1, 3), (0, 3)]
    );
}

#[test]
fn a_deferred_cell_is_dropped_when_the_runnable_work_fills_the_buffer() {
    // Deferral is not a promise: if the cells that can start now take the buffer to
    // its target, the throttled harness simply waits for the next top-up rather than
    // overshooting on work that would only sit `pending`.
    let cells = [on_harness(0, 5, 0, 0), on_harness(1, 5, 0, 0)];
    let harnesses = [capped(2, 2), HarnessCapacity::UNLIMITED];
    assert_eq!(pairs(&top_up(&cells, &harnesses, 5, 0)), vec![(1, 5)]);
}

#[test]
fn a_plan_on_one_throttled_harness_still_queues_the_full_buffer() {
    // Nothing to interleave with, so the fix must not shrink the queue: the second
    // pass restores exactly the depth the buffer asked for. Without it a plan would
    // hold only as many runs as can execute at once and stop dead the moment the
    // reviewer stopped submitting reviews — top-up is an endpoint, not a daemon.
    let cells = [cell(2, 0, 0), cell(2, 0, 0), cell(2, 0, 0), cell(2, 0, 0)];
    let harnesses = [capped(0, 2)];
    assert_eq!(
        pairs(&top_up(&cells, &harnesses, 6, 0)),
        vec![(0, 2), (1, 2), (2, 2)]
    );
}

#[test]
fn each_harness_is_fed_in_turn_while_it_has_room() {
    // Two throttled harnesses interleaved: both are fed up to their caps in the
    // first pass, in the caller's order, and only then does either go deeper.
    let cells = [
        on_harness(0, 1, 0, 0),
        on_harness(1, 1, 0, 0),
        on_harness(0, 1, 0, 0),
        on_harness(1, 1, 0, 0),
        on_harness(0, 1, 0, 0),
    ];
    let harnesses = [capped(0, 2), capped(0, 1)];
    // Lane 0 takes cells 0 and 2 (its cap of two); lane 1 takes cell 1 and is then
    // full, deferring cell 3. Cell 4 is past lane 0's cap, so it too is deferred —
    // and both come back in order once the runnable pass is done.
    assert_eq!(
        pairs(&top_up(&cells, &harnesses, 10, 0)),
        vec![(0, 1), (1, 1), (2, 1), (3, 1), (4, 1)]
    );
}

#[test]
fn a_zero_cap_holds_every_cell_back_to_the_second_pass() {
    // A harness throttled to nothing (or a nonsense stored cap) can never start a
    // run, so it is deferred rather than preferred — but the plan is still allowed
    // to queue against it, because the cap may be lifted before the runs are claimed.
    let cells = [on_harness(0, 2, 0, 0), on_harness(1, 2, 0, 0)];
    let harnesses = [capped(0, 0), HarnessCapacity::UNLIMITED];
    assert_eq!(
        pairs(&top_up(&cells, &harnesses, 10, 0)),
        vec![(1, 2), (0, 2)]
    );
}

#[test]
fn a_harness_lane_the_caller_did_not_describe_counts_as_unlimited() {
    // A cell pointing past the end of the capacity slice must not borrow another
    // harness's throttle, and must not be deferred for want of information.
    let cells = [on_harness(7, 2, 0, 0), on_harness(0, 2, 0, 0)];
    let harnesses = [capped(9, 1)];
    assert_eq!(
        pairs(&top_up(&cells, &harnesses, 10, 0)),
        vec![(0, 2), (1, 2)]
    );
}
