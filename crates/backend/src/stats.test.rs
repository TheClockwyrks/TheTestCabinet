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
    assert_eq!(acme.models[0].clean, 1);
    assert_eq!(acme.models[0].errored, 0);
    let providerless = &probes[1];
    assert_eq!(providerless.provider, None);
    assert_eq!(providerless.models[0].errored, 1);
}
