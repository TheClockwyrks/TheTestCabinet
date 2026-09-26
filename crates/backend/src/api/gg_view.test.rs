use super::*;

/// A save body for a query.
fn sample_query(name: &str) -> GgSavedQueryInput {
    GgSavedQueryInput {
        name: name.to_string(),
        description: "  overflow, per model  ".to_string(),
        query: "  has.summary:true | stats avg(summary.ranOutOfContext) by model  ".to_string(),
        range_id: "30d".to_string(),
    }
}

/// A save body for a board with one panel.
fn sample_board(name: &str) -> GgDashboardInput {
    GgDashboardInput {
        name: name.to_string(),
        description: String::new(),
        panels: vec![GgDashboardPanel {
            title: "  Sessions  ".to_string(),
            query: "| stats count() by bucket(started, 1d)".to_string(),
            width: 12,
        }],
        range_id: "all".to_string(),
    }
}

#[test]
fn saved_query_from_input_trims_every_free_text_field() {
    let saved = saved_query_from_input(
        "q1".to_string(),
        sample_query("  overflow  "),
        "2026-08-01T00:00:00Z",
    )
    .unwrap();
    assert_eq!(saved.id, "q1");
    assert_eq!(saved.name, "overflow");
    assert_eq!(saved.description, "overflow, per model");
    assert_eq!(
        saved.query,
        "has.summary:true | stats avg(summary.ranOutOfContext) by model"
    );
    assert_eq!(saved.range_id, "30d");
    assert_eq!(saved.updated_at, "2026-08-01T00:00:00Z");
}

#[test]
fn saved_query_keeps_the_source_text_rather_than_compiling_it() {
    // The stored form is what was typed, relative date and all: that is what makes a
    // saved question re-resolve on every run instead of freezing the window it was
    // written in. The backend never parses text, so nothing here can normalise it away.
    let input = GgSavedQueryInput {
        query: "started >= now-30d and model:\"anthropic/*\"".to_string(),
        ..sample_query("recent anthropic")
    };
    let saved = saved_query_from_input("q1".to_string(), input, "2026-08-01T00:00:00Z").unwrap();
    assert_eq!(saved.query, "started >= now-30d and model:\"anthropic/*\"");
}

#[test]
fn an_empty_query_is_savable_and_means_the_whole_corpus() {
    let input = GgSavedQueryInput {
        query: "   ".to_string(),
        ..sample_query("everything")
    };
    let saved = saved_query_from_input("q1".to_string(), input, "2026-08-01T00:00:00Z").unwrap();
    assert_eq!(saved.query, "");
}

#[test]
fn saved_query_rejects_a_blank_name() {
    let input = GgSavedQueryInput {
        name: "   ".to_string(),
        ..sample_query("ignored")
    };
    let err = saved_query_from_input("q1".to_string(), input, "2026-08-01T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn saved_query_rejects_an_overlong_name_description_or_query() {
    for input in [
        GgSavedQueryInput {
            name: "n".repeat(MAX_NAME_LEN + 1),
            ..sample_query("ignored")
        },
        GgSavedQueryInput {
            description: "d".repeat(MAX_DESCRIPTION_LEN + 1),
            ..sample_query("named")
        },
        GgSavedQueryInput {
            query: "q".repeat(MAX_QUERY_LEN + 1),
            ..sample_query("named")
        },
    ] {
        let err =
            saved_query_from_input("q1".to_string(), input, "2026-08-01T00:00:00Z").unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
    }
}

#[test]
fn dashboard_from_input_validates_and_trims_its_panels() {
    let board = dashboard_from_input(
        "d1".to_string(),
        sample_board("overview"),
        "2026-08-01T00:00:00Z",
    )
    .unwrap();
    assert_eq!(board.panels.len(), 1);
    assert_eq!(board.panels[0].title, "Sessions");
    assert_eq!(board.range_id, "all");
}

#[test]
fn a_panel_width_off_the_grid_is_rejected_naming_the_bound_and_the_value() {
    // A board saved with a width nobody sent is a board laid out differently from the
    // one the operator saved, with a `200` saying it went in as typed. The console's
    // own field refuses the same two values before it submits.
    let too_wide = GgDashboardInput {
        panels: vec![GgDashboardPanel {
            title: "Too wide".to_string(),
            query: String::new(),
            width: 99,
        }],
        ..sample_board("off the grid")
    };
    let err = dashboard_from_input("d1".to_string(), too_wide, "2026-08-01T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        err.message,
        "a dashboard panel spans at most 12 columns (got 99)"
    );

    let too_narrow = GgDashboardInput {
        panels: vec![GgDashboardPanel {
            title: "Too narrow".to_string(),
            query: String::new(),
            width: 0,
        }],
        ..sample_board("off the grid")
    };
    let err =
        dashboard_from_input("d1".to_string(), too_narrow, "2026-08-01T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        err.message,
        "a dashboard panel spans at least 1 column (got 0)"
    );
}

#[test]
fn a_panel_spanning_the_whole_grid_is_stored_as_sent() {
    // Both ends of the range are storable: the rejection is of what falls outside it,
    // not of the edges.
    for width in [MIN_PANEL_WIDTH, DASHBOARD_COLUMNS] {
        let input = GgDashboardInput {
            panels: vec![GgDashboardPanel {
                title: "Sessions".to_string(),
                query: String::new(),
                width,
            }],
            ..sample_board("on the grid")
        };
        let board = dashboard_from_input("d1".to_string(), input, "2026-08-01T00:00:00Z").unwrap();
        assert_eq!(board.panels[0].width, width);
    }
}

#[test]
fn a_panel_with_a_blank_title_is_rejected() {
    let input = GgDashboardInput {
        panels: vec![GgDashboardPanel {
            title: "  ".to_string(),
            query: String::new(),
            width: 6,
        }],
        ..sample_board("untitled panel")
    };
    let err = dashboard_from_input("d1".to_string(), input, "2026-08-01T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn a_board_may_not_carry_more_panels_than_one_batch_can_answer() {
    // The ceiling is not arbitrary: a board is drawn by exactly one batched request, so
    // a board that could hold more panels than a batch carries would be undrawable.
    assert_eq!(MAX_DASHBOARD_PANELS, super::super::GG_QUERY_MAX_BATCH);
    let input = GgDashboardInput {
        panels: (0..MAX_DASHBOARD_PANELS + 1)
            .map(|i| GgDashboardPanel {
                title: format!("panel {i}"),
                query: String::new(),
                width: 6,
            })
            .collect(),
        ..sample_board("too many")
    };
    let err = dashboard_from_input("d1".to_string(), input, "2026-08-01T00:00:00Z").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn a_view_saved_without_a_range_covers_the_whole_corpus() {
    // gg runs are recorded in bursts, so a view that silently defaulted to a recent
    // window would open empty with no clue that the corpus is fine.
    let saved: GgSavedQueryInput = serde_json::from_value(serde_json::json!({
        "name": "everything",
        "query": "",
    }))
    .unwrap();
    assert_eq!(saved.range_id, "all");
    let board: GgDashboardInput =
        serde_json::from_value(serde_json::json!({ "name": "board" })).unwrap();
    assert_eq!(board.range_id, "all");
    assert!(board.panels.is_empty());
}
