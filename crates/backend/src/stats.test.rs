use super::*;

use test_cabinet_core::gg::GgErrorSummary;
use test_cabinet_core::metrics::{Cost, TokenCounts};

/// A new-format run: per-`(provider, model)` slices recorded.
fn sliced_run(id: &str, model: &str, slices: Vec<GgProviderStat>) -> Arc<GgRunFacts> {
    Arc::new(GgRunFacts {
        id: id.to_string(),
        model_id: model.to_string(),
        execution_mode: "responses_as_code".to_string(),
        errors: GgErrorSummary::default(),
        tool_calls: 0,
        provider_stats: slices,
        models: [model.to_string()].into_iter().collect(),
    })
}

/// An old-format run: no slices, no dispatch total — only the run-level error
/// rollup, over the given model set.
fn old_run(id: &str, mode: &str, models: &[&str], errors: GgErrorSummary) -> Arc<GgRunFacts> {
    Arc::new(GgRunFacts {
        id: id.to_string(),
        model_id: models[0].to_string(),
        execution_mode: mode.to_string(),
        errors,
        tool_calls: 0,
        provider_stats: Vec::new(),
        models: models.iter().map(|m| m.to_string()).collect(),
    })
}

/// A slice with the given provider/model and call/turn figures.
fn slice(
    provider: Option<&str>,
    model: Option<&str>,
    calls: u64,
    turns: u64,
    working: u64,
    errors: &[(&str, u64)],
) -> GgProviderStat {
    GgProviderStat {
        provider: provider.map(str::to_string),
        model_id: model.map(str::to_string),
        calls,
        tokens: TokenCounts {
            uncached_input: Some(100 * calls),
            cached_input: Some(10 * calls),
            output: Some(calls),
            reasoning: None,
        },
        cost: (calls > 0).then_some(Cost {
            comparable: Some(0.5 * calls as f64),
            actual: Some(0.5 * calls as f64),
        }),
        rejected: 0,
        turns,
        working,
        errors: errors
            .iter()
            .map(|(kind, count)| (kind.to_string(), *count))
            .collect(),
    }
}

#[test]
fn new_format_slices_fold_per_provider_and_model() {
    let facts = vec![
        sliced_run(
            "r1",
            "alpha/one",
            vec![
                slice(
                    Some("acme"),
                    Some("alpha/one"),
                    4,
                    4,
                    3,
                    &[("transpile_compile", 1)],
                ),
                slice(Some("zenith"), Some("alpha/one"), 2, 2, 2, &[]),
            ],
        ),
        sliced_run(
            "r2",
            "alpha/one",
            vec![slice(Some("acme"), Some("alpha/one"), 6, 6, 6, &[])],
        ),
    ];
    let (scanned, with_data, providers) = fold_provider_stats(&facts);
    assert_eq!(scanned, 2);
    assert_eq!(with_data, 2);
    assert_eq!(providers.len(), 2);

    let acme = &providers[0];
    assert_eq!(acme.provider.as_deref(), Some("acme"));
    assert_eq!(acme.totals.runs, 2, "distinct runs, not a sum of rows");
    assert_eq!(acme.totals.calls, 10);
    assert_eq!(acme.totals.total_tokens, 10 * 111);
    assert_eq!(acme.totals.cost, Some(5.0));
    assert_eq!(acme.totals.turns, 10);
    assert_eq!(acme.totals.working, 9);
    assert_eq!(acme.totals.errors.get("transpile_compile"), Some(&1));
    assert_eq!(acme.models.len(), 1);
    assert_eq!(acme.models[0].model_id.as_deref(), Some("alpha/one"));
    assert_eq!(acme.models[0].stats.runs, 2);

    assert_eq!(providers[1].provider.as_deref(), Some("zenith"));
    assert_eq!(providers[1].totals.calls, 2);
}

#[test]
fn provider_totals_sum_their_model_rows() {
    let facts = vec![sliced_run(
        "r1",
        "alpha/one",
        vec![
            slice(
                Some("acme"),
                Some("alpha/one"),
                3,
                3,
                2,
                &[("program_throw", 1)],
            ),
            slice(Some("acme"), Some("beta/two"), 5, 4, 4, &[]),
        ],
    )];
    let (_, _, providers) = fold_provider_stats(&facts);
    let acme = &providers[0];
    let summed_calls: u64 = acme.models.iter().map(|row| row.stats.calls).sum();
    let summed_turns: u64 = acme.models.iter().map(|row| row.stats.turns).sum();
    let summed_working: u64 = acme.models.iter().map(|row| row.stats.working).sum();
    assert_eq!(acme.totals.calls, summed_calls);
    assert_eq!(acme.totals.turns, summed_turns);
    assert_eq!(acme.totals.working, summed_working);
}

#[test]
fn a_modelless_slice_resolves_to_the_runs_sole_model() {
    let facts = vec![sliced_run(
        "r1",
        "alpha/one",
        vec![slice(Some("acme"), None, 1, 1, 1, &[])],
    )];
    let (_, _, providers) = fold_provider_stats(&facts);
    assert_eq!(
        providers[0].models[0].model_id.as_deref(),
        Some("alpha/one"),
        "a single-model run's modelless slice is attributed to that model"
    );
}

#[test]
fn a_modelless_slice_on_a_multi_model_run_stays_modelless() {
    let mut run = sliced_run(
        "r1",
        "alpha/one",
        vec![slice(Some("acme"), None, 1, 1, 1, &[])],
    );
    Arc::make_mut(&mut run)
        .models
        .insert("beta/two".to_string());
    let (_, _, providers) = fold_provider_stats(&[run]);
    assert_eq!(providers[0].models[0].model_id, None);
}

#[test]
fn old_format_runs_are_scanned_but_contribute_no_providers() {
    let facts = vec![old_run(
        "r1",
        "responses_as_code",
        &["alpha/one"],
        GgErrorSummary {
            turns: 5,
            errors: 1,
            transpile: 1,
            ..GgErrorSummary::default()
        },
    )];
    let (scanned, with_data, providers) = fold_provider_stats(&facts);
    assert_eq!(scanned, 1);
    assert_eq!(with_data, 0);
    assert!(providers.is_empty());
}

#[test]
fn providers_order_named_by_calls_then_name_with_providerless_last() {
    let facts = vec![sliced_run(
        "r1",
        "alpha/one",
        vec![
            slice(None, Some("alpha/one"), 9, 9, 9, &[]),
            slice(Some("small"), Some("alpha/one"), 1, 1, 1, &[]),
            slice(Some("big"), Some("alpha/one"), 5, 5, 5, &[]),
            slice(Some("also-big"), Some("alpha/one"), 5, 5, 5, &[]),
        ],
    )];
    let (_, _, providers) = fold_provider_stats(&facts);
    let order: Vec<Option<&str>> = providers
        .iter()
        .map(|entry| entry.provider.as_deref())
        .collect();
    assert_eq!(
        order,
        vec![Some("also-big"), Some("big"), Some("small"), None],
        "calls desc, name asc, providerless last even with the most calls"
    );
}

#[test]
fn exact_slices_drive_per_model_rac_figures() {
    let facts = vec![sliced_run(
        "r1",
        "alpha/one",
        vec![
            slice(
                Some("acme"),
                Some("alpha/one"),
                6,
                6,
                4,
                &[("transpile_compile", 1), ("sandbox_trap", 1)],
            ),
            slice(Some("zenith"), Some("beta/two"), 3, 3, 3, &[]),
        ],
    )];
    let response = fold_model_accuracy(&facts);
    assert_eq!(response.unattributable_runs, 0);
    assert_eq!(response.models.len(), 2);

    let alpha = &response.models[0];
    assert_eq!(alpha.model_id, "alpha/one");
    let rac = alpha.rac.as_ref().expect("rac figures");
    assert_eq!(rac.runs, 1);
    assert_eq!(rac.turns, 6);
    assert_eq!(rac.valid, 4);
    assert_eq!(rac.compile, 1);
    assert_eq!(rac.runtime, 1, "a sandbox trap groups as runtime");
    assert_eq!(rac.approximate_runs, 0);
    assert_eq!(rac.by_type.get("transpile_compile"), Some(&1));
    assert!(alpha.tool_calling.is_none());

    let beta = &response.models[1];
    assert_eq!(beta.model_id, "beta/two");
    assert_eq!(beta.rac.as_ref().expect("rac figures").valid, 3);
}

#[test]
fn an_old_single_model_run_folds_approximately() {
    let facts = vec![old_run(
        "r1",
        "responses_as_code",
        &["alpha/one"],
        GgErrorSummary {
            turns: 8,
            errors: 3,
            model_api: 1,
            transpile: 2,
            by_type: [
                ("transpile_compile".to_string(), 2),
                ("model_timeout".to_string(), 1),
            ]
            .into_iter()
            .collect(),
            ..GgErrorSummary::default()
        },
    )];
    let response = fold_model_accuracy(&facts);
    let rac = response.models[0].rac.as_ref().expect("rac figures");
    assert_eq!(rac.turns, 8);
    assert_eq!(rac.valid, 5, "turns minus errors on the approximate path");
    assert_eq!(rac.compile, 2);
    assert_eq!(rac.model_errors, 1);
    assert_eq!(rac.approximate_runs, 1);
}

#[test]
fn an_old_multi_model_run_is_unattributable() {
    let facts = vec![old_run(
        "r1",
        "responses_as_code",
        &["alpha/one", "beta/two"],
        GgErrorSummary {
            turns: 4,
            ..GgErrorSummary::default()
        },
    )];
    let response = fold_model_accuracy(&facts);
    assert!(response.models.is_empty());
    assert_eq!(response.unattributable_runs, 1);
}

#[test]
fn tool_calling_totals_split_ok_and_failures() {
    let errors = GgErrorSummary {
        tool_failures: [
            ("not-found".to_string(), 2),
            ("invalid-argument".to_string(), 1),
        ]
        .into_iter()
        .collect(),
        ..GgErrorSummary::default()
    };
    let mut run = old_run("r1", "tool_calling", &["alpha/one"], errors);
    Arc::make_mut(&mut run).tool_calls = 10;
    let response = fold_model_accuracy(&[run]);
    let tool = response.models[0]
        .tool_calling
        .as_ref()
        .expect("tool figures");
    assert_eq!(tool.runs, 1);
    assert_eq!(tool.calls, 10);
    assert_eq!(tool.ok, 7);
    assert_eq!(tool.failures.get("invalid-argument"), Some(&1));
    assert_eq!(tool.runs_without_call_totals, 0);
    assert!(response.models[0].rac.is_none());
}

#[test]
fn a_tool_calling_run_without_totals_is_tallied_not_defaulted() {
    let errors = GgErrorSummary {
        tool_failures: [("other".to_string(), 3)].into_iter().collect(),
        ..GgErrorSummary::default()
    };
    let facts = vec![old_run("r1", "tool_calling", &["alpha/one"], errors)];
    let response = fold_model_accuracy(&facts);
    let tool = response.models[0]
        .tool_calling
        .as_ref()
        .expect("tool figures");
    assert_eq!(
        tool.calls, 0,
        "no denominator is recorded, so none is invented"
    );
    assert_eq!(tool.ok, 0);
    assert!(
        tool.failures.is_empty(),
        "a rate that cannot be stated folds nothing"
    );
    assert_eq!(tool.runs_without_call_totals, 1);
}

#[test]
fn a_tool_calling_run_with_no_evidence_contributes_nothing() {
    let facts = vec![old_run(
        "r1",
        "tool_calling",
        &["alpha/one"],
        GgErrorSummary::default(),
    )];
    let response = fold_model_accuracy(&facts);
    assert!(response.models.is_empty());
    assert_eq!(response.unattributable_runs, 0);
}

#[test]
fn models_order_by_evidence_volume() {
    let facts = vec![
        sliced_run(
            "r1",
            "small/model",
            vec![slice(Some("acme"), Some("small/model"), 2, 2, 2, &[])],
        ),
        sliced_run(
            "r2",
            "big/model",
            vec![slice(Some("acme"), Some("big/model"), 9, 9, 9, &[])],
        ),
    ];
    let response = fold_model_accuracy(&facts);
    let order: Vec<&str> = response
        .models
        .iter()
        .map(|entry| entry.model_id.as_str())
        .collect();
    assert_eq!(order, vec!["big/model", "small/model"]);
}

#[test]
fn probe_items_fold_per_provider_and_model() {
    let rows: Vec<ProbeItemRow> = vec![
        (Some("acme".to_string()), "alpha".to_string(), true, false),
        (Some("acme".to_string()), "alpha".to_string(), false, false),
        (Some("acme".to_string()), "beta".to_string(), true, false),
        (None, "alpha".to_string(), false, true),
    ];
    let probes = fold_probe_providers(&rows);
    assert_eq!(probes.len(), 2);
    let acme = &probes[0];
    assert_eq!(acme.provider.as_deref(), Some("acme"));
    assert_eq!(acme.models.len(), 2);
    assert_eq!(acme.models[0].model_slug, "alpha");
    assert_eq!(acme.models[0].items, 2);
    assert_eq!(acme.models[0].passes, 1);
    assert_eq!(acme.models[0].errored, 0);
    let providerless = &probes[1];
    assert_eq!(providerless.provider, None);
    assert_eq!(providerless.models[0].errored, 1);
}

// --- fold_cabinet_stats ------------------------------------------------------

/// A Wednesday anchor for the cabinet fold: its week's Monday is 2026-08-24, so
/// the 52-week window opens on 2025-09-01.
fn cabinet_now() -> time::OffsetDateTime {
    time::macros::datetime!(2026-08-26 12:00 UTC)
}

/// A cabinet projection row with everything reported.
fn cabinet_row(
    started_at: &str,
    tokens: i64,
    cost: Option<f64>,
    case: &str,
    model: &str,
) -> CabinetRunRow {
    (
        started_at.to_string(),
        tokens,
        cost,
        case.to_string(),
        model.to_string(),
    )
}

#[test]
fn an_empty_cabinet_still_charts_the_full_window_of_zero_weeks() {
    let stats = fold_cabinet_stats(&[], cabinet_now());
    assert_eq!(stats.runs, 0);
    assert_eq!(stats.tokens.total, 0);
    assert_eq!(stats.tokens.unreported_runs, 0);
    assert_eq!(stats.cost.total, 0.0);
    assert_eq!(stats.cost.unreported_runs, 0);
    assert_eq!(stats.test_cases, 0);
    assert_eq!(stats.models, 0);
    // Explicit zero entries for every week, ascending, Mondays throughout.
    assert_eq!(stats.weekly.len(), 52);
    assert_eq!(stats.weekly.first().unwrap().week_start, "2025-09-01");
    assert_eq!(stats.weekly.last().unwrap().week_start, "2026-08-24");
    assert!(stats.weekly.iter().all(|week| week.runs == 0));
}

#[test]
fn cabinet_totals_exclude_and_count_unreported_tokens_and_cost() {
    let rows = vec![
        cabinet_row("2026-08-25T10:00:00Z", 1_000, Some(2.5), "pong", "sonnet"),
        // A lifted `0` is an unreported token total (the record's `None` stores
        // as zero), and a NULL cost is unknown: both count, neither sums.
        cabinet_row("2026-08-25T11:00:00Z", 0, None, "pong", "opus"),
        cabinet_row("2026-08-25T12:00:00Z", 500, Some(0.0), "meltdown", "sonnet"),
    ];
    let stats = fold_cabinet_stats(&rows, cabinet_now());
    assert_eq!(stats.runs, 3);
    assert_eq!(stats.tokens.total, 1_500);
    assert_eq!(stats.tokens.unreported_runs, 1);
    // A genuine 0.0 (a free run) is a known cost: summed, not counted.
    assert_eq!(stats.cost.total, 2.5);
    assert_eq!(stats.cost.unreported_runs, 1);
    // Distinct identities, not row counts.
    assert_eq!(stats.test_cases, 2);
    assert_eq!(stats.models, 2);
}

#[test]
fn cabinet_weekly_buckets_by_the_utc_monday_of_the_iso_week() {
    let rows = vec![
        // Monday and Sunday of one ISO week share its Monday bucket…
        cabinet_row("2026-08-17T00:00:00Z", 1, None, "pong", "m"),
        cabinet_row("2026-08-23T23:59:59Z", 1, None, "pong", "m"),
        // …and the bucketing is on the UTC instant: late Sunday in a +02:00
        // offset is already Monday nowhere, but 23:30+02:00 is 21:30 UTC Sunday.
        cabinet_row("2026-08-23T23:30:00+02:00", 1, None, "pong", "m"),
        // The current (partial) week is included…
        cabinet_row("2026-08-26T09:00:00Z", 1, None, "pong", "m"),
        // …a run older than the window counts in the totals but charts nowhere…
        cabinet_row("2025-01-01T00:00:00Z", 1, None, "pong", "m"),
        // …and so does one whose timestamp does not parse.
        cabinet_row("not-a-timestamp", 1, None, "pong", "m"),
    ];
    let stats = fold_cabinet_stats(&rows, cabinet_now());
    assert_eq!(stats.runs, 6);
    let week = |start: &str| {
        stats
            .weekly
            .iter()
            .find(|week| week.week_start == start)
            .unwrap_or_else(|| panic!("week {start} missing"))
            .runs
    };
    assert_eq!(week("2026-08-17"), 3);
    assert_eq!(week("2026-08-24"), 1);
    assert_eq!(stats.weekly.iter().map(|week| week.runs).sum::<u64>(), 4);
    // Ascending, and every entry a Monday one week apart.
    let starts: Vec<&str> = stats
        .weekly
        .iter()
        .map(|week| week.week_start.as_str())
        .collect();
    let mut sorted = starts.clone();
    sorted.sort();
    assert_eq!(starts, sorted);
}

#[test]
fn week_monday_is_identity_on_mondays_and_floors_the_rest_of_the_week() {
    let monday = time::macros::date!(2026 - 08 - 24);
    assert_eq!(week_monday(monday), monday);
    assert_eq!(week_monday(time::macros::date!(2026 - 08 - 30)), monday);
    // A year boundary inside a week floors into the old year.
    assert_eq!(
        week_monday(time::macros::date!(2026 - 01 - 01)),
        time::macros::date!(2025 - 12 - 29)
    );
    assert_eq!(format_week_start(monday), "2026-08-24");
}
