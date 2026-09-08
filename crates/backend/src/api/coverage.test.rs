//! Unit tests for the coverage transport's pure parts: member resolution, the
//! outer-axis cell ordering, the counts a matrix cell reports, and the demand the
//! shared top-up scheduler is fed.
//!
//! Everything here avoids the store on purpose — [`MatrixCtx`] is constructed
//! directly from counts, which is exactly what it is: a snapshot of four grouped
//! reads plus a latest-version map. The reads themselves are covered in the db
//! layer's tests; what matters here is that the transport keys into them correctly
//! and orders the result the way the plan asked for.
//!
//! The gg half of a member — resolving a configuration, binding its launch slots, and
//! what that does to a cell's identity — lives beside this in `coverage.gg.test.rs`.

use super::*;

use crate::coverage::schedule::{HarnessCapacity, top_up};

pub(super) fn combo(model: &str) -> ReviewPlanCombo {
    combo_on(HarnessSlug::Claude, model)
}

/// The same, on an explicit harness rather than the default Claude Code.
pub(super) fn combo_on(harness: HarnessSlug, model: &str) -> ReviewPlanCombo {
    ReviewPlanCombo {
        harness,
        model: model.to_string(),
        provider: None,
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        gg_config_name: None,
    }
}

/// An account with no saved gg configurations — every member in this file is a harness
/// member, which resolves without consulting them at all.
pub(super) fn no_configs() -> GgLibrary {
    GgLibrary::default()
}

/// One combination resolved into the member the matrix and the top-up actually walk.
pub(super) fn member(combo: ReviewPlanCombo) -> PlanMember {
    resolve_member(&combo, &no_configs())
}

/// The same for a whole list, which is the shape every cell-ordering assertion needs.
pub(super) fn members(combos: Vec<ReviewPlanCombo>) -> Vec<PlanMember> {
    combos.into_iter().map(member).collect()
}

pub(super) fn case(slug: &str) -> ReviewPlanCase {
    ReviewPlanCase {
        slug: slug.to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        engine: None,
    }
}

/// The same pinned case on an explicit engine.
fn case_on(slug: &str, engine: &str) -> ReviewPlanCase {
    ReviewPlanCase {
        engine: Some(engine.to_string()),
        ..case(slug)
    }
}

pub(super) fn combo_group(id: &str, combos: Vec<ReviewPlanCombo>) -> CoverageGroup {
    CoverageGroup {
        id: id.to_string(),
        name: id.to_string(),
        kind: CoverageGroupKind::Combo,
        combos,
        cases: vec![],
        updated_at: "2026-07-15T00:00:00Z".to_string(),
    }
}

fn case_group(id: &str, cases: Vec<ReviewPlanCase>) -> CoverageGroup {
    CoverageGroup {
        id: id.to_string(),
        name: id.to_string(),
        kind: CoverageGroupKind::Case,
        combos: vec![],
        cases,
        updated_at: "2026-07-15T00:00:00Z".to_string(),
    }
}

fn plan(
    combo_group_ids: Vec<&str>,
    case_group_ids: Vec<&str>,
    combos: Vec<ReviewPlanCombo>,
    cases: Vec<ReviewPlanCase>,
) -> CoveragePlan {
    CoveragePlan {
        id: "p1".to_string(),
        name: "plan".to_string(),
        runs_per_cell: 3,
        combo_group_ids: combo_group_ids.into_iter().map(String::from).collect(),
        case_group_ids: case_group_ids.into_iter().map(String::from).collect(),
        combos,
        cases,
        updated_at: "2026-07-15T00:00:00Z".to_string(),
    }
}

/// A context whose counts are all empty — every cell reads zero of everything.
pub(super) fn empty_ctx() -> MatrixCtx {
    MatrixCtx {
        completed: crate::db::CellCounts::new(),
        in_flight: crate::db::CellCounts::new(),
        pending: crate::db::CellCounts::new(),
        unreviewed: crate::db::CellCounts::new(),
        // Every harness idle and unthrottled, which is the default deployment and
        // the state in which the top-up walks its cells in plain order.
        harness_capacity: vec![HarnessCapacity::UNLIMITED; HarnessSlug::RUNNABLE.len()],
        latest_by_slug: HashMap::new(),
    }
}

/// The cell ordering, rendered as `slug/member` strings so an assertion reads as the
/// order a reviewer would see. A gg member reads as its configuration's name, which is
/// what identifies it — its model is shared with every other member on that model.
pub(super) fn order(cells: &[(&ReviewPlanCase, &PlanMember)]) -> Vec<String> {
    cells
        .iter()
        .map(|(case, member)| {
            let label = member
                .combo
                .gg_config_name
                .clone()
                .unwrap_or_else(|| member.combo.model.clone());
            format!("{}/{label}", case.slug)
        })
        .collect()
}

#[test]
fn resolve_dedupes_a_member_shared_by_two_groups() {
    let groups: HashMap<String, CoverageGroup> = [
        combo_group("g1", vec![combo("opus"), combo("sonnet")]),
        combo_group("g2", vec![combo("sonnet"), combo("haiku")]),
        case_group("c1", vec![case("pong")]),
        case_group("c2", vec![case("pong"), case("carom")]),
    ]
    .into_iter()
    .map(|g| (g.id.clone(), g))
    .collect();
    let p = plan(vec!["g1", "g2"], vec!["c1", "c2"], vec![], vec![]);

    let (combos, cases) = resolve_members(&p, &groups, &no_configs());
    // `sonnet` is in both combo groups; `pong` in both case groups — each once.
    assert_eq!(
        combos
            .iter()
            .map(|c| c.combo.model.as_str())
            .collect::<Vec<_>>(),
        vec!["opus", "sonnet", "haiku"]
    );
    assert_eq!(
        cases.iter().map(|c| c.slug.as_str()).collect::<Vec<_>>(),
        vec!["pong", "carom"]
    );
}

#[test]
fn a_stored_pin_from_before_the_engine_existed_still_deserializes() {
    // A plan's and a group's cases are stored as a JSON blob, so the serde default on the
    // new field is the whole of what keeps an existing row readable — there is no
    // migration for it, and an existing plan must keep asking for exactly the engineless
    // runs it always asked for.
    let stored = r#"[{"slug":"pong","version":"v1.0.0","variant":"base"}]"#;
    let cases: Vec<ReviewPlanCase> =
        serde_json::from_str(stored).expect("a pre-engine pin still parses");
    assert_eq!(cases[0].engine, None);
    assert_eq!(cases[0].engine_slug(), "none");
    // And a pin with no engine is written back without the key, so a round trip does not
    // rewrite every stored plan.
    assert_eq!(serde_json::to_string(&cases).unwrap(), stored);
}

#[test]
fn one_case_on_two_engines_is_two_pinned_cases() {
    let groups: HashMap<String, CoverageGroup> = [combo_group("g1", vec![combo("opus")])]
        .into_iter()
        .map(|g| (g.id.clone(), g))
        .collect();
    // The engine is part of the pin because results are only comparable within one
    // engine, so these are two cases the plan crosses its combinations with separately —
    // not one case listed twice.
    let p = plan(
        vec!["g1"],
        vec![],
        vec![],
        vec![case("pong"), case_on("pong", "simple-2d")],
    );

    let (combos, cases) = resolve_members(&p, &groups, &no_configs());
    assert_eq!(
        cases.iter().map(|c| c.engine_slug()).collect::<Vec<_>>(),
        vec!["none", "simple-2d"]
    );
    // And two cells, counted apart: a run built on one engine satisfies nothing pinned to
    // the other.
    assert_ne!(
        cell_key(&cases[0], &combos[0]),
        cell_key(&cases[1], &combos[0])
    );
}

#[test]
fn a_pin_naming_no_engine_and_one_naming_none_are_the_same_case() {
    let groups: HashMap<String, CoverageGroup> = HashMap::new();
    // `none` is the engineless run, which is exactly what an absent pin asks for. Two
    // spellings of one pin must be one case, or a plan saved by a console that writes the
    // slug out would silently double every cell it already had.
    let p = plan(
        vec![],
        vec![],
        vec![],
        vec![case("pong"), case_on("pong", "none")],
    );

    let (_, cases) = resolve_members(&p, &groups, &no_configs());
    assert_eq!(cases.len(), 1);
    assert_eq!(
        cell_key(&case("pong"), &member(combo("opus"))),
        cell_key(&case_on("pong", "none"), &member(combo("opus")))
    );
}

#[test]
fn a_top_up_launches_a_harness_cell_on_the_cases_pinned_engine() {
    let m = member(combo("opus"));
    let cell = |case: &ReviewPlanCase| {
        top_up_launch_body(&TopUpCell {
            rung_id: None,
            case,
            member: &m,
            runs: 2,
        })
    };

    // The whole pin travels onto the launch, engine included. A run built on another
    // engine satisfies nothing this cell counted, so the cell that asked for the runs and
    // the runs it gets have to name the same one.
    let body = cell(&case_on("pong", "simple-2d"));
    assert_eq!(body.test_case, "pong");
    assert_eq!(body.version, "v1.0.0");
    assert_eq!(body.variant, "base");
    assert_eq!(body.engine.as_deref(), Some("simple-2d"));
    assert_eq!(body.harness, HarnessSlug::Claude);

    // A case pinning no engine sends no engine key, which is the `none` default — exactly
    // the engineless build every plan scheduled before the pin carried an engine got.
    assert_eq!(cell(&case("pong")).engine, None);
    // And a pin spelling that default out asks for the same run rather than a second one.
    assert_eq!(
        cell(&case_on("pong", "none")).engine.as_deref(),
        Some("none")
    );
}

#[test]
fn a_blocked_cell_reports_the_engine_it_would_have_launched_on() {
    // A cell nothing can launch is reported rather than dropped, and the report is what
    // the console names the cell by — so it carries the resolved engine for the same
    // reason it carries the version: two engines are two cells, and a reason attached to
    // the wrong one is unactionable.
    let blocked = blocked_cell(
        None,
        &case_on("pong", "simple-2d"),
        &member(combo("opus")),
        "no window".to_string(),
    );
    assert_eq!(blocked.engine, "simple-2d");
    assert_eq!(
        blocked_cell(
            None,
            &case("pong"),
            &member(combo("opus")),
            "no window".to_string()
        )
        .engine,
        "none"
    );
}

#[test]
fn resolve_dedupes_a_one_off_that_repeats_a_group_member() {
    let groups: HashMap<String, CoverageGroup> = [combo_group("g1", vec![combo("opus")])]
        .into_iter()
        .map(|g| (g.id.clone(), g))
        .collect();
    // The one-off `opus` duplicates the group's member and must not double it.
    let p = plan(
        vec!["g1"],
        vec![],
        vec![combo("opus"), combo("sonnet")],
        vec![],
    );

    let (combos, _) = resolve_members(&p, &groups, &no_configs());
    assert_eq!(
        combos
            .iter()
            .map(|c| c.combo.model.as_str())
            .collect::<Vec<_>>(),
        vec!["opus", "sonnet"]
    );
}

#[test]
fn resolve_skips_a_dangling_group_reference() {
    let groups: HashMap<String, CoverageGroup> = [combo_group("g1", vec![combo("opus")])]
        .into_iter()
        .map(|g| (g.id.clone(), g))
        .collect();
    // `gX` no longer names a group (deleted); it is silently skipped, not an error.
    let p = plan(vec!["g1", "gX"], vec!["cX"], vec![], vec![case("pong")]);

    let (combos, cases) = resolve_members(&p, &groups, &no_configs());
    assert_eq!(combos.len(), 1);
    assert_eq!(combos[0].combo.model, "opus");
    // The dangling case group contributes nothing; only the one-off case remains.
    assert_eq!(cases.len(), 1);
    assert_eq!(cases[0].slug, "pong");
}

#[test]
fn provider_distinguishes_two_otherwise_identical_combos() {
    let with_provider = ReviewPlanCombo {
        provider: Some("openrouter".to_string()),
        ..combo_on(HarnessSlug::Opencode, "anthropic/claude-opus-4.8")
    };
    let no_provider = combo_on(HarnessSlug::Opencode, "anthropic/claude-opus-4.8");
    let p = plan(vec![], vec![], vec![with_provider, no_provider], vec![]);
    let (combos, _) = resolve_members(&p, &HashMap::new(), &no_configs());
    // Same harness+model but different provider → two distinct combinations.
    assert_eq!(combos.len(), 2);
}

#[test]
fn a_ladders_climbers_resolve_through_the_same_combo_resolver() {
    let groups: HashMap<String, CoverageGroup> =
        [combo_group("g1", vec![combo("opus"), combo("sonnet")])]
            .into_iter()
            .map(|g| (g.id.clone(), g))
            .collect();
    // A ladder holds only combo pointers and one-offs; the same resolver serves it,
    // with the same de-dupe, so a plan and a ladder can never disagree about what
    // one saved group means.
    let combos = resolve_combos(
        &["g1".to_string()],
        &[combo("sonnet"), combo("haiku")],
        &groups,
        &no_configs(),
    );
    assert_eq!(
        combos
            .iter()
            .map(|c| c.combo.model.as_str())
            .collect::<Vec<_>>(),
        vec!["opus", "sonnet", "haiku"]
    );
}

#[test]
fn the_case_axis_keeps_one_cases_combinations_adjacent() {
    let cases = vec![case("pong"), case("carom")];
    let combos = members(vec![combo("opus"), combo("sonnet")]);
    let cells = cells_in_order(CoverageAxis::Case, &combos, &cases);
    assert_eq!(
        order(&cells),
        vec!["pong/opus", "pong/sonnet", "carom/opus", "carom/sonnet"]
    );
}

#[test]
fn the_combination_axis_keeps_one_models_cases_adjacent() {
    let cases = vec![case("pong"), case("carom")];
    let combos = members(vec![combo("opus"), combo("sonnet")]);
    let cells = cells_in_order(CoverageAxis::Combination, &combos, &cases);
    // The same four cells, re-nested: one model is taken all the way through the
    // plan before the next one starts.
    assert_eq!(
        order(&cells),
        vec!["pong/opus", "carom/opus", "pong/sonnet", "carom/sonnet"]
    );
}

#[test]
fn an_unknown_stored_axis_falls_back_to_the_default() {
    assert_eq!(CoverageAxis::parse("case"), CoverageAxis::Case);
    assert_eq!(
        CoverageAxis::parse("combination"),
        CoverageAxis::Combination
    );
    // A token from a newer build must not make the plan unreadable — the axis only
    // decides emission order, so it degrades to today's ordering.
    assert_eq!(CoverageAxis::parse("rung"), CoverageAxis::Case);
    assert_eq!(CoverageAxis::parse(""), CoverageAxis::Case);
}

#[test]
fn a_cell_is_keyed_by_the_model_the_run_was_launched_with() {
    let c = case("pong");
    // OpenCode reaches its model through OpenRouter, so a run of this combination is
    // recorded under the prefixed id — the key has to match that, not the plan's
    // canonical model, or the cell reads zero forever.
    let routed = ReviewPlanCombo {
        provider: Some("openrouter".to_string()),
        ..combo_on(HarnessSlug::Opencode, "anthropic/claude-opus-4.8")
    };
    assert_eq!(
        cell_key(&c, &member(routed)).5,
        "openrouter/anthropic/claude-opus-4.8"
    );
    // A harness that is not provider-routed launches its id verbatim.
    assert_eq!(cell_key(&c, &member(combo("opus"))).5, "opus");
}

#[test]
fn a_cell_reports_the_requesters_unreviewed_runs_alongside_the_global_counts() {
    let c = case("pong");
    let m = member(combo("opus"));
    let key = cell_key(&c, &m);
    let mut ctx = empty_ctx();
    ctx.completed.insert(key.clone(), 5);
    ctx.in_flight.insert(key.clone(), 2);
    ctx.pending.insert(key.clone(), 1);
    ctx.unreviewed.insert(key, 3);

    let cell = ctx.cell(5, &c, &m);
    // Counts stay global: five runs exist, so the target is met whoever produced them.
    assert_eq!(cell.completed, 5);
    assert_eq!(cell.remaining, 0);
    // `pending` is a subset of `inFlight`, never an addition to it.
    assert_eq!(cell.in_flight, 2);
    assert_eq!(cell.pending, 1);
    // Judgement is per-account: three of the five are still waiting on this reviewer.
    assert_eq!(cell.unreviewed, 3);
}

#[test]
fn the_matrix_rollups_sum_the_per_account_and_global_numbers_separately() {
    let cases = vec![case("pong"), case("carom")];
    let combos = members(vec![combo("opus")]);
    let mut ctx = empty_ctx();
    ctx.completed.insert(cell_key(&cases[0], &combos[0]), 5);
    ctx.unreviewed.insert(cell_key(&cases[0], &combos[0]), 2);
    ctx.in_flight.insert(cell_key(&cases[1], &combos[0]), 1);

    let matrix = ctx.matrix(
        5,
        CoverageAxis::Case,
        BufferTarget::Bounded { runs: 10 },
        &combos,
        &cases,
    );
    assert_eq!(matrix.cells_total, 2);
    // `pong` is satisfied by its five completed runs; `carom` still needs four.
    assert_eq!(matrix.cells_satisfied, 1);
    assert_eq!(matrix.runs_missing, 4);
    assert_eq!(matrix.runs_unreviewed, 2);
    // Outstanding is what the buffer bounds: everything in flight plus everything
    // finished the reviewer has not judged.
    assert_eq!(matrix.runs_outstanding, 3);
    assert_eq!(matrix.buffer_target, BufferTarget::Bounded { runs: 10 });
    assert_eq!(matrix.outer_axis, CoverageAxis::Case);
}

#[test]
fn a_stale_pin_is_flagged_against_the_newest_ingested_version() {
    let c = case("pong");
    let m = member(combo("opus"));
    let mut ctx = empty_ctx();
    ctx.latest_by_slug
        .insert("pong".to_string(), "v2.0.0".to_string());
    assert!(ctx.cell(3, &c, &m).stale);

    // A case that is not ingested at all has no newer version to point at, so it is
    // not flagged — the reviewer has nothing to bump the pin to.
    let ctx = empty_ctx();
    let cell = ctx.cell(3, &c, &m);
    assert!(!cell.stale);
    assert_eq!(cell.latest_version, "");
}

#[test]
fn the_top_up_walks_the_configured_axis_and_emits_whole_cells() {
    let cases = vec![case("pong"), case("carom")];
    let combos = members(vec![combo("opus"), combo("sonnet")]);
    let ctx = empty_ctx();

    // One case at a time, buffer 5, five runs per cell: the first cell alone
    // overshoots the buffer, which is correct — a cell's repeats are the unit of
    // judgement and must not be split across two top-ups.
    let ordered = cells_in_order(CoverageAxis::Case, &combos, &cases);
    let demands: Vec<_> = ordered
        .iter()
        .map(|(case, member)| ctx.demand(5, case, member))
        .collect();
    let launches = top_up(
        &demands,
        ctx.harness_capacity(),
        BufferTarget::Bounded { runs: 5 },
        0,
    );
    assert_eq!(launches.len(), 1);
    assert_eq!(launches[0].runs, 5);
    assert_eq!(order(&[ordered[launches[0].cell]]), vec!["pong/opus"]);

    // The same plan on the other axis starts the same case, but the second cell it
    // would reach is the *other* model's `pong`, not `opus`'s `carom`.
    let ordered = cells_in_order(CoverageAxis::Combination, &combos, &cases);
    let demands: Vec<_> = ordered
        .iter()
        .map(|(case, member)| ctx.demand(5, case, member))
        .collect();
    let launches = top_up(
        &demands,
        ctx.harness_capacity(),
        BufferTarget::Bounded { runs: 10 },
        0,
    );
    assert_eq!(
        launches
            .iter()
            .map(|launch| order(&[ordered[launch.cell]]).remove(0))
            .collect::<Vec<_>>(),
        vec!["pong/opus", "carom/opus"]
    );
}

#[test]
fn a_throttled_harness_does_not_starve_the_rest_of_the_plan() {
    // "One model at a time" puts every Claude cell first, so a plain in-order walk
    // spends the whole buffer on a harness capped at two and leaves Codex — which
    // could start immediately — idle. The scheduler reads the cap and interleaves.
    let cases = vec![case("pong"), case("carom")];
    let combos = members(vec![
        combo_on(HarnessSlug::Claude, "opus"),
        combo_on(HarnessSlug::Codex, "gpt"),
    ]);
    let mut ctx = empty_ctx();
    ctx.harness_capacity[harness_lane(HarnessSlug::Claude)] = HarnessCapacity {
        in_flight: 0,
        max_parallel: Some(2),
    };

    let ordered = cells_in_order(CoverageAxis::Combination, &combos, &cases);
    let demands: Vec<_> = ordered
        .iter()
        .map(|(case, member)| ctx.demand(2, case, member))
        .collect();
    let launches = top_up(
        &demands,
        ctx.harness_capacity(),
        BufferTarget::Bounded { runs: 8 },
        0,
    );
    // Claude's first cell fills its two slots, so its second is deferred behind both
    // of Codex's — and only then takes the buffer that is left.
    assert_eq!(
        launches
            .iter()
            .map(|launch| order(&[ordered[launch.cell]]).remove(0))
            .collect::<Vec<_>>(),
        vec!["pong/opus", "pong/gpt", "carom/gpt", "carom/opus"]
    );
}

#[test]
fn a_harness_already_at_its_cap_yields_the_buffer_to_one_that_is_not() {
    // The steady state: Claude's earlier runs are still working through the queue,
    // so nothing more of it can start until they do.
    let cases = vec![case("pong")];
    let combos = members(vec![
        combo_on(HarnessSlug::Claude, "opus"),
        combo_on(HarnessSlug::Codex, "gpt"),
    ]);
    let mut ctx = empty_ctx();
    ctx.harness_capacity[harness_lane(HarnessSlug::Claude)] = HarnessCapacity {
        in_flight: 6,
        max_parallel: Some(2),
    };

    let ordered = cells_in_order(CoverageAxis::Case, &combos, &cases);
    let demands: Vec<_> = ordered
        .iter()
        .map(|(case, member)| ctx.demand(3, case, member))
        .collect();
    let launches = top_up(
        &demands,
        ctx.harness_capacity(),
        BufferTarget::Bounded { runs: 3 },
        0,
    );
    // Only three buffer slots, and the runnable harness gets them.
    assert_eq!(
        launches
            .iter()
            .map(|launch| order(&[ordered[launch.cell]]).remove(0))
            .collect::<Vec<_>>(),
        vec!["pong/gpt"]
    );
}

#[test]
fn every_runnable_harness_has_its_own_capacity_lane() {
    // The lanes must be distinct and must all land inside the slice `empty_ctx`
    // sizes from `HarnessSlug::RUNNABLE`, or a cell would borrow another harness's
    // throttle — or silently read as unlimited. gg is in that list precisely so its
    // runs are throttled by their own cap rather than by nothing.
    let lanes: Vec<usize> = HarnessSlug::RUNNABLE
        .iter()
        .copied()
        .map(harness_lane)
        .collect();
    let mut unique = lanes.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), HarnessSlug::RUNNABLE.len());
    assert!(lanes.iter().all(|lane| *lane < HarnessSlug::RUNNABLE.len()));
    assert!(harness_lane(HarnessSlug::Gg) < HarnessSlug::RUNNABLE.len());
}

#[test]
fn a_satisfied_cell_is_skipped_rather_than_stopping_the_walk() {
    let cases = vec![case("pong"), case("carom")];
    let combos = members(vec![combo("opus")]);
    let mut ctx = empty_ctx();
    ctx.completed.insert(cell_key(&cases[0], &combos[0]), 5);

    let ordered = cells_in_order(CoverageAxis::Case, &combos, &cases);
    let demands: Vec<_> = ordered
        .iter()
        .map(|(case, member)| ctx.demand(5, case, member))
        .collect();
    let launches = top_up(
        &demands,
        ctx.harness_capacity(),
        BufferTarget::Bounded { runs: 10 },
        0,
    );
    // `pong` is done and costs nothing; the walk continues to `carom` rather than
    // stalling behind a finished case.
    assert_eq!(launches.len(), 1);
    assert_eq!(order(&[ordered[launches[0].cell]]), vec!["carom/opus"]);
}

#[test]
fn unreviewed_runs_hold_the_buffer_closed_even_when_nothing_is_in_flight() {
    let cases = vec![case("pong")];
    let combos = members(vec![combo("opus")]);
    let mut ctx = empty_ctx();
    // Ten finished runs of another cell that this reviewer has not looked at is a
    // full buffer: the plan is not idle because it is done, it is idle because the
    // reviewer owes it attention.
    ctx.unreviewed.insert(cell_key(&cases[0], &combos[0]), 10);
    ctx.completed.insert(cell_key(&cases[0], &combos[0]), 10);

    let ordered = cells_in_order(CoverageAxis::Case, &combos, &cases);
    let demands: Vec<_> = ordered
        .iter()
        .map(|(case, member)| ctx.demand(15, case, member))
        .collect();
    assert_eq!(demands[0].outstanding(), 10);
    assert!(
        top_up(
            &demands,
            ctx.harness_capacity(),
            BufferTarget::Bounded { runs: 10 },
            10
        )
        .is_empty()
    );
}

#[test]
fn a_plan_input_clamps_its_target_and_keeps_the_schedule_separate() {
    let input = CoveragePlanInput {
        name: "wide".to_string(),
        runs_per_cell: 9_999,
        combo_group_ids: vec![],
        case_group_ids: vec![],
        combos: vec![],
        cases: vec![],
        schedule: None,
    };
    let (plan, schedule) = plan_from_input("p1".to_string(), input, "2026-08-15T00:00:00Z");
    assert_eq!(plan.runs_per_cell, MAX_RUNS_PER_CELL);
    // No schedule in the body means "leave it alone" on update and "the default" on
    // create — never a silently written one.
    assert!(schedule.is_none());

    let input = CoveragePlanInput {
        name: "narrow".to_string(),
        runs_per_cell: 0,
        combo_group_ids: vec![],
        case_group_ids: vec![],
        combos: vec![],
        cases: vec![],
        schedule: Some(CoverageSchedule {
            outer_axis: CoverageAxis::Combination,
            paused: true,
            auto_top_up: true,
            buffer_target: Some(BufferTarget::Bounded { runs: 99_999 }),
        }),
    };
    let (plan, schedule) = plan_from_input("p2".to_string(), input, "2026-08-15T00:00:00Z");
    // A target of zero would declare a cell nobody wants; one run is the floor.
    assert_eq!(plan.runs_per_cell, 1);
    let schedule = schedule.expect("the body carried a schedule");
    assert_eq!(schedule.outer_axis, CoverageAxis::Combination);
    assert!(schedule.paused);
    // The buffer bounds a top-up's fan-out, so a mistyped value is clamped on the
    // way to the store.
    assert_eq!(
        schedule.to_db().buffer_target,
        Some(BufferTarget::Bounded {
            runs: MAX_BUFFER_TARGET
        })
    );
}

#[test]
fn a_zero_buffer_target_survives_clamping() {
    // "Never top me up automatically" is a real instruction and must be storable —
    // unlike a runs-per-cell target of zero, which would declare a cell nobody wants.
    let bounded = |runs| BufferTarget::Bounded { runs };
    assert_eq!(clamp_buffer_target(bounded(0)), bounded(0));
    assert_eq!(clamp_buffer_target(bounded(7)), bounded(7));
    assert_eq!(
        clamp_buffer_target(bounded(u32::MAX)),
        bounded(MAX_BUFFER_TARGET)
    );
}

#[test]
fn an_unbounded_buffer_target_is_not_clamped_into_a_bound() {
    // The ceiling exists to catch a mistyped *number*. "No bound" is not a number
    // that can be mistyped, and turning it into the largest bound would quietly
    // reintroduce the stall the reviewer chose it to avoid.
    assert_eq!(
        clamp_buffer_target(BufferTarget::Unbounded),
        BufferTarget::Unbounded
    );
    let schedule = CoverageSchedule {
        buffer_target: Some(BufferTarget::Unbounded),
        ..CoverageSchedule::default()
    };
    assert_eq!(
        schedule.to_db().buffer_target,
        Some(BufferTarget::Unbounded)
    );
    assert_eq!(CoverageSchedule::from_db(schedule.to_db()), schedule);
}

#[test]
fn a_schedule_names_its_buffer_shape_on_the_wire() {
    // A client has to be able to tell the three instructions apart from the JSON
    // alone: absent (inherit), a bound, and no bound.
    let inherit = serde_json::to_value(CoverageSchedule::default()).unwrap();
    assert!(inherit.get("bufferTarget").is_none());
    let unbounded = serde_json::to_value(CoverageSchedule {
        buffer_target: Some(BufferTarget::Unbounded),
        ..CoverageSchedule::default()
    })
    .unwrap();
    assert_eq!(
        unbounded["bufferTarget"],
        serde_json::json!({ "kind": "unbounded" })
    );
    let parsed: CoverageSchedule = serde_json::from_value(serde_json::json!({
        "outerAxis": "case",
        "paused": false,
        "autoTopUp": true,
        "bufferTarget": { "kind": "bounded", "runs": 3 }
    }))
    .unwrap();
    assert_eq!(
        parsed.buffer_target,
        Some(BufferTarget::Bounded { runs: 3 })
    );
}

#[test]
fn a_schedule_round_trips_through_the_stores_shape() {
    let schedule = CoverageSchedule {
        outer_axis: CoverageAxis::Combination,
        paused: true,
        auto_top_up: true,
        buffer_target: Some(BufferTarget::Bounded { runs: 4 }),
    };
    assert_eq!(CoverageSchedule::from_db(schedule.to_db()), schedule);
    // The default is the behaviour a plan had before it could be scheduled at all,
    // and matches the columns' database defaults.
    let default = CoverageSchedule::default();
    assert_eq!(default.outer_axis, CoverageAxis::Case);
    assert!(!default.paused);
    assert!(!default.auto_top_up);
    assert_eq!(default.buffer_target, None);
}

#[test]
fn a_skipped_top_up_still_reports_what_it_was_aiming_for() {
    let result = TopUpResult::skipped_by(TopUpSkipped::Paused, BufferTarget::Bounded { runs: 12 });
    assert_eq!(result.skipped, Some(TopUpSkipped::Paused));
    assert_eq!(result.buffer_target, BufferTarget::Bounded { runs: 12 });
    // `outstanding` is absent rather than zero: the scheduler never ran, so nobody
    // measured it, and reporting zero would read as an empty buffer.
    assert_eq!(result.outstanding, None);
    assert_eq!(result.enqueued, 0);
}
