use super::*;

/// A cell wanting `target` runs, with `counted` finished and `in_flight` coming. On
/// harness lane 0 — the only lane that matters when the test passes no capacities.
fn cell(target: u32, counted: u32, in_flight: u32) -> CellDemand {
    on_harness(0, target, counted, in_flight)
}

/// The same, on an explicit harness lane.
fn on_harness(harness: usize, target: u32, counted: u32, in_flight: u32) -> CellDemand {
    CellDemand {
        target,
        counted,
        in_flight,
        harness,
        serialized: false,
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

/// A limit that stops once `runs` jobs are in flight — the shape every test below
/// exercises unless it is specifically about the unbounded one.
fn bounded(runs: u32) -> InFlightLimit {
    InFlightLimit::Bounded { runs }
}

/// The jobs in flight across `cells`, as the caller would count them by origin.
fn in_flight_across(cells: &[CellDemand]) -> u32 {
    cells.iter().map(|c| c.in_flight).sum()
}

/// Flatten a decision into `(cell index, runs)` pairs for terse assertions.
fn pairs(launches: &[CellLaunch]) -> Vec<(usize, u32)> {
    launches.iter().map(|l| (l.cell, l.runs)).collect()
}

#[test]
fn an_empty_plan_launches_nothing() {
    assert!(launch_pass(&[], &[], bounded(10), 0).is_empty());
}

#[test]
fn a_fully_satisfied_plan_launches_nothing() {
    // Every cell is at its target globally, so there is no work regardless of how
    // much room the limit has.
    let cells = [cell(5, 5, 0), cell(5, 3, 2), cell(5, 6, 0)];
    assert!(launch_pass(&cells, &[], bounded(50), 0).is_empty());
}

#[test]
fn a_full_limit_launches_nothing_even_with_work_missing() {
    let cells = [cell(5, 0, 0), cell(5, 0, 0)];
    // In flight is already at the limit: the queue holds all this owner may claim.
    assert!(launch_pass(&cells, &[], bounded(4), 4).is_empty());
    // And past it — a previous pass's deliberate overshoot.
    assert!(launch_pass(&cells, &[], bounded(4), 7).is_empty());
}

#[test]
fn a_cell_is_emitted_whole_never_split_to_fit_the_limit() {
    // The limit has room for three but the first cell is missing five. It is
    // emitted whole: a case's repeats are compared against each other, so they
    // must land in the queue together.
    let cells = [cell(5, 0, 0), cell(5, 0, 0)];
    assert_eq!(
        pairs(&launch_pass(&cells, &[], bounded(3), 0)),
        vec![(0, 5)]
    );
}

#[test]
fn the_overshoot_is_bounded_to_one_cell() {
    // Buffer of 6, cells of 5: the first takes it to 5 (under target, so the
    // second is emitted too) and the second overshoots to 10. The third is not
    // reached — the overshoot never compounds.
    let cells = [cell(5, 0, 0), cell(5, 0, 0), cell(5, 0, 0)];
    assert_eq!(
        pairs(&launch_pass(&cells, &[], bounded(6), 0)),
        vec![(0, 5), (1, 5)]
    );
}

#[test]
fn launching_stops_exactly_at_the_limit() {
    // Cells of 2 against a limit of 6 divide evenly, so there is no overshoot and
    // the fourth cell is left for the next pass.
    let cells = [cell(2, 0, 0), cell(2, 0, 0), cell(2, 0, 0), cell(2, 0, 0)];
    assert_eq!(
        pairs(&launch_pass(&cells, &[], bounded(6), 0)),
        vec![(0, 2), (1, 2), (2, 2)]
    );
}

#[test]
fn a_satisfied_cell_is_skipped_without_stalling_the_ones_behind_it() {
    // The middle cell is done; the walk continues past it rather than stopping.
    let cells = [cell(2, 2, 0), cell(2, 0, 0), cell(2, 1, 0)];
    assert_eq!(
        pairs(&launch_pass(&cells, &[], bounded(10), 0)),
        vec![(1, 2), (2, 1)]
    );
}

#[test]
fn cells_are_launched_in_the_order_they_were_passed() {
    // The caller's slice order *is* the configured outer axis, and enqueue order is
    // execution order, so the decision must never reorder it.
    let cells = [cell(1, 0, 0), cell(1, 0, 0), cell(1, 0, 0)];
    assert_eq!(
        pairs(&launch_pass(&cells, &[], bounded(3), 0)),
        vec![(0, 1), (1, 1), (2, 1)]
    );
}

#[test]
fn in_flight_jobs_count_toward_a_cell_target() {
    // Three of five are already coming, so only the shortfall of two is launched.
    let cells = [cell(5, 0, 3)];
    assert_eq!(
        pairs(&launch_pass(&cells, &[], bounded(10), 3)),
        vec![(0, 2)]
    );
}

#[test]
fn a_cell_past_its_target_reports_no_shortfall() {
    // Hand-launched extras took the cell past its target; the subtraction saturates
    // rather than wrapping into a huge launch.
    let overshot = cell(3, 5, 1);
    assert_eq!(overshot.missing(), 0);
    assert!(launch_pass(&[overshot], &[], bounded(10), 0).is_empty());
}

#[test]
fn an_unbounded_limit_emits_every_missing_cell_whatever_is_in_flight() {
    // The occupancy is already far past any bound an owner would set, and the walk
    // still emits every cell with a shortfall — satisfied cells are the only thing it
    // skips.
    let cells = [cell(5, 0, 0), cell(5, 5, 0), cell(5, 2, 1), cell(5, 0, 0)];
    assert_eq!(
        pairs(&launch_pass(&cells, &[], InFlightLimit::Unbounded, 1_000)),
        vec![(0, 5), (2, 2), (3, 5)]
    );
    // Nor does it invent work: once every cell is at target there is nothing left.
    let full = [cell(5, 5, 0), cell(5, 3, 2)];
    assert!(launch_pass(&full, &[], InFlightLimit::Unbounded, 1_000).is_empty());
}

#[test]
fn completed_runs_never_occupy_the_limit() {
    // A finished run, reviewed or not, is not in flight: a limit of 5 with ten counted
    // runs and nothing in flight still launches the next cell.
    let cells = [cell(5, 5, 0), cell(5, 5, 0), cell(5, 0, 0)];
    assert_eq!(
        pairs(&launch_pass(
            &cells,
            &[],
            bounded(5),
            in_flight_across(&cells)
        )),
        vec![(2, 5)]
    );
}

#[test]
fn an_unbounded_limit_still_queues_a_capped_harness_no_deeper_than_its_free_slots() {
    // No bound does not lift the cap: the full harness gets nothing and the one with
    // room gets only its free slots, while an uncapped harness takes its whole cell.
    let cells = [
        on_harness(0, 5, 0, 0),
        on_harness(1, 5, 0, 0),
        on_harness(2, 5, 0, 0),
    ];
    let harnesses = [capped(2, 2), capped(0, 4), HarnessCapacity::UNLIMITED];
    assert_eq!(
        pairs(&launch_pass(
            &cells,
            &harnesses,
            InFlightLimit::Unbounded,
            0
        )),
        vec![(1, 4), (2, 5)]
    );
}

#[test]
fn an_in_flight_limit_knows_when_it_is_full() {
    assert!(!bounded(3).is_full(2));
    assert!(bounded(3).is_full(3));
    assert!(bounded(3).is_full(4));
    assert!(bounded(0).is_full(0));
    assert!(!InFlightLimit::Unbounded.is_full(0));
    assert!(!InFlightLimit::Unbounded.is_full(u32::MAX));
    assert_eq!(bounded(3).bound(), Some(3));
    assert_eq!(InFlightLimit::Unbounded.bound(), None);
}

#[test]
fn an_in_flight_limit_is_tagged_on_the_wire() {
    // The two shapes have to be told apart by a client that only sees JSON, and a
    // stored `{ kind: "bounded", runs }` must read back as the same instruction.
    assert_eq!(
        serde_json::to_value(bounded(7)).unwrap(),
        serde_json::json!({ "kind": "bounded", "runs": 7 })
    );
    assert_eq!(
        serde_json::to_value(InFlightLimit::Unbounded).unwrap(),
        serde_json::json!({ "kind": "unbounded" })
    );
    let parsed: InFlightLimit =
        serde_json::from_value(serde_json::json!({ "kind": "unbounded" })).unwrap();
    assert_eq!(parsed, InFlightLimit::Unbounded);
}

#[test]
fn a_zero_limit_launches_nothing() {
    // A limit of zero is an instruction in its own right: nothing launches, without
    // touching the queue.
    let cells = [cell(5, 0, 0)];
    assert!(launch_pass(&cells, &[], bounded(0), 0).is_empty());
}

#[test]
fn repeating_a_launch_pass_after_enqueueing_moves_to_the_next_cells() {
    // Idempotence in the way that matters: once the first decision's launches are in
    // flight, re-running the algorithm returns the *next* slice of work, never the
    // same one again.
    let before = [cell(5, 0, 0), cell(5, 0, 0), cell(5, 0, 0)];
    let first = launch_pass(&before, &[], bounded(5), in_flight_across(&before));
    assert_eq!(pairs(&first), vec![(0, 5)]);

    let after = [cell(5, 0, 5), cell(5, 0, 0), cell(5, 0, 0)];
    // The five are still in flight, so the limit stays full and nothing is added.
    assert!(launch_pass(&after, &[], bounded(5), in_flight_across(&after)).is_empty());

    // Once they finish, the limit has room again and cell 1 is next.
    let finished = [cell(5, 5, 0), cell(5, 0, 0), cell(5, 0, 0)];
    assert_eq!(
        pairs(&launch_pass(
            &finished,
            &[],
            bounded(5),
            in_flight_across(&finished)
        )),
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
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(0, 2), (1, 2)]
    );
}

#[test]
fn a_throttled_harness_does_not_spend_the_whole_limit_before_an_idle_one() {
    // Every early cell belongs to a harness capped at two, so a plain in-order walk
    // would queue the whole limit behind it and leave the second harness, which could
    // start immediately, with nothing.
    let cells = [
        on_harness(0, 2, 0, 0),
        on_harness(0, 2, 0, 0),
        on_harness(0, 2, 0, 0),
        on_harness(1, 2, 0, 0),
        on_harness(1, 2, 0, 0),
    ];
    let harnesses = [capped(0, 2), HarnessCapacity::UNLIMITED];
    // Cell 0 fills the throttled harness's two slots, so its siblings wait for a later
    // pass and the idle harness takes the room they would have occupied.
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(0, 2), (3, 2), (4, 2)]
    );
}

#[test]
fn a_ladder_of_capped_models_queues_only_what_each_harness_can_start() {
    // Two models on one harness capped at two, five runs per rung, under the default
    // limit of ten: queueing both cells whole would put eight runs in `pending` and
    // fill the limit with them. Only the two that can start are queued.
    let cells = [on_harness(0, 5, 0, 0), on_harness(0, 5, 0, 0)];
    let harnesses = [capped(0, 2)];
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(0, 2)]
    );

    // Ten models, each on its own harness capped at two: every model gets its two
    // slots, and the limit is spent on runs that start rather than on one model's
    // whole rung.
    let cells: Vec<CellDemand> = (0..10).map(|lane| on_harness(lane, 5, 0, 0)).collect();
    let harnesses = [capped(0, 2); 10];
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(20), 0)),
        (0..10).map(|cell| (cell, 2)).collect::<Vec<_>>()
    );
}

#[test]
fn a_capped_cell_is_launched_in_part_and_the_rest_follows_as_slots_free() {
    // The repeats of a cell on a capped harness go out as slots free: two now, and
    // after one of them finishes, one more.
    let harnesses = [capped(0, 2)];
    let first = launch_pass(&[cell(5, 0, 0)], &harnesses, bounded(10), 0);
    assert_eq!(pairs(&first), vec![(0, 2)]);

    // Both still in flight: the harness is full, so nothing more.
    assert!(launch_pass(&[cell(5, 0, 2)], &[capped(2, 2)], bounded(10), 2).is_empty());

    // One finished: one slot is free, and the cell takes it.
    assert_eq!(
        pairs(&launch_pass(
            &[cell(5, 1, 1)],
            &[capped(1, 2)],
            bounded(10),
            1
        )),
        vec![(0, 1)]
    );
}

#[test]
fn a_harness_already_at_its_cap_launches_nothing() {
    // The throttled harness's earlier runs are still working through the queue, so
    // nothing more of it can start. The other harness's cells go out, and the capped
    // cell waits for a slot rather than sitting `pending`.
    let cells = [on_harness(0, 3, 0, 0), on_harness(1, 3, 0, 0)];
    let harnesses = [capped(4, 2), HarnessCapacity::UNLIMITED];
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(1, 3)]
    );
}

#[test]
fn runs_queued_elsewhere_for_a_capped_harness_take_its_slots() {
    // Capacity is global: one run another plan queued for the harness leaves this pass
    // one slot, so the cell is launched one run deep.
    let cells = [cell(5, 0, 0)];
    let harnesses = [capped(1, 2)];
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(0, 1)]
    );
}

#[test]
fn the_limit_still_bounds_a_capped_harness_with_free_slots() {
    // Free slots are an upper bound, not an allowance: the owner's limit is checked
    // first, so a pass whose limit is full queues nothing even on an idle harness.
    let cells = [cell(5, 0, 0)];
    let harnesses = [capped(0, 4)];
    assert!(launch_pass(&cells, &harnesses, bounded(3), 3).is_empty());
}

#[test]
fn each_harness_is_fed_in_turn_up_to_its_cap() {
    // Two throttled harnesses interleaved: each is fed up to its cap in the caller's
    // order, and the cells past a cap wait for a later pass.
    let cells = [
        on_harness(0, 1, 0, 0),
        on_harness(1, 1, 0, 0),
        on_harness(0, 1, 0, 0),
        on_harness(1, 1, 0, 0),
        on_harness(0, 1, 0, 0),
    ];
    let harnesses = [capped(0, 2), capped(0, 1)];
    // Lane 0 takes cells 0 and 2 (its cap of two); lane 1 takes cell 1 and is then
    // full, so cell 3 waits. Cell 4 is past lane 0's cap and waits too.
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(0, 1), (1, 1), (2, 1)]
    );
}

#[test]
fn a_zero_cap_launches_nothing_on_its_harness() {
    // A nonsense stored cap reads as zero, which holds the harness's runs back rather
    // than quietly lifting the throttle; the other harness is unaffected.
    let cells = [on_harness(0, 2, 0, 0), on_harness(1, 2, 0, 0)];
    let harnesses = [capped(0, 0), HarnessCapacity::UNLIMITED];
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(1, 2)]
    );
}

#[test]
fn a_harness_lane_the_caller_did_not_describe_counts_as_unlimited() {
    // A cell pointing past the end of the capacity slice must not borrow another
    // harness's throttle, and must not be held back for want of information. The cell
    // on the full lane it would have borrowed from is the one that waits.
    let cells = [on_harness(7, 2, 0, 0), on_harness(0, 2, 0, 0)];
    let harnesses = [capped(9, 1)];
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(0, 2)]
    );
}

#[test]
fn a_serialized_cell_takes_one_slot_however_many_runs_it_queues() {
    // A game jam's entries by one model run one at a time, so two queued entries hold one
    // slot between them and the cell behind them gets the other.
    let jam = CellDemand {
        serialized: true,
        ..on_harness(0, 2, 0, 0)
    };
    let cells = [jam, on_harness(0, 2, 0, 0)];
    let harnesses = [capped(0, 2)];
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(0, 2), (1, 1)]
    );

    // With an entry already in flight, the cell's next one waits behind it and takes no
    // slot of its own.
    let jam = CellDemand {
        serialized: true,
        ..on_harness(0, 3, 0, 1)
    };
    let cells = [jam, on_harness(0, 2, 0, 0)];
    let harnesses = [capped(1, 3)];
    assert_eq!(
        pairs(&launch_pass(&cells, &harnesses, bounded(10), 0)),
        vec![(0, 2), (1, 2)]
    );
}
