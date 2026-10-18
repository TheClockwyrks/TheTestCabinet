//! The test-case-group listing (`GET /test-case-groups`).
//!
//! Serves the [test-case group](test_cabinet_core::TestCaseGroup) set the last
//! whole-catalog ingest wrote into the definition store (see
//! [`crate::ingest`]), already in display order — the ordering `rank` is applied
//! before the set is stored and does not ride the wire. An open read, like the
//! test-case catalog: the set backs the home page's per-group leaderboards,
//! which every visitor sees.

#[cfg(test)]
#[path = "test_case_groups.test.rs"]
mod tests;

use axum::Json;
use axum::extract::State;
use test_cabinet_core::TestCaseGroup;

use crate::error::ApiError;

use super::AppState;

pub use test_cabinet_contracts::backend_api::test_cases::{
    TestCaseGroupOut, TestCaseGroupsResponse,
};

/// `GET /test-case-groups` — every ingested test-case group, in display order.
/// A store from before groups existed (or a checkout declaring none) serves an
/// empty list, not an error.
pub async fn list(State(state): State<AppState>) -> Result<Json<TestCaseGroupsResponse>, ApiError> {
    let groups = state
        .store
        .read_test_case_groups()
        .map_err(ApiError::from)?;
    Ok(Json(TestCaseGroupsResponse {
        groups: groups.into_iter().map(test_case_group_out).collect(),
    }))
}

/// A test-case group as the API serves it.
pub fn test_case_group_out(group: TestCaseGroup) -> TestCaseGroupOut {
    TestCaseGroupOut {
        slug: group.slug,
        name: group.name,
        summary: group.summary,
        cases: group.cases,
    }
}
