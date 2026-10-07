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
use serde::Serialize;
use test_cabinet_core::TestCaseGroup;

use crate::error::ApiError;

use super::AppState;

/// `GET /test-case-groups` — every ingested test-case group, in display order.
/// A store from before groups existed (or a checkout declaring none) serves an
/// empty list, not an error.
pub async fn list(State(state): State<AppState>) -> Result<Json<TestCaseGroupsResponse>, ApiError> {
    let groups = state
        .store
        .read_test_case_groups()
        .map_err(ApiError::from)?;
    Ok(Json(TestCaseGroupsResponse {
        groups: groups.into_iter().map(TestCaseGroupOut::from).collect(),
    }))
}

/// The `GET /test-case-groups` envelope: the groups under a wrapping key so the
/// response can grow new fields without breaking readers, like the catalog's.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct TestCaseGroupsResponse {
    /// Every ingested group, in display order (rank ascending then name, with
    /// ranked groups before unranked ones — resolved at ingest).
    pub groups: Vec<TestCaseGroupOut>,
}

/// One test-case group as served — the manifest minus `rank`, which orders the
/// listing server-side and deliberately does not ride the wire.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct TestCaseGroupOut {
    /// The group's stable slug.
    pub slug: String,
    /// Display name, heading the group's home-page leaderboard.
    pub name: String,
    /// Optional one-line description, or null.
    pub summary: Option<String>,
    /// The ordered member test-case/game-jam slugs, by manifest-declared
    /// identity (the slug run records carry).
    pub cases: Vec<String>,
}

impl From<TestCaseGroup> for TestCaseGroupOut {
    fn from(group: TestCaseGroup) -> Self {
        TestCaseGroupOut {
            slug: group.slug,
            name: group.name,
            summary: group.summary,
            cases: group.cases,
        }
    }
}
