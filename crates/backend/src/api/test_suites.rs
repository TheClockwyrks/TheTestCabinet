//! The [test suite](https://docs.testcabinet.ai/test-suites/overview/) read
//! endpoints: the listing, one version's resolved record, and the bytes that
//! record points at.
//!
//! Every one of these reads the [store](crate::suite_store) rather than the
//! checkout, so a deployment whose checkout is absent still serves exactly what it
//! ingested. The stored record *is* the version response body, flattened beside the
//! one thing ingest cannot know: the reference builds uploaded for the version since.
//! The listing is the identity half of each record.

#[cfg(test)]
#[path = "test_suites.test.rs"]
mod tests;

use axum::Json;
use axum::extract::{Path, State};
use axum::response::Response;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::store::DefinitionStore;
use crate::suite_store::{StoredSuite, SuiteVersionIdentity};

use super::AppState;
use super::suite_reference_builds::{declared_engines, reference_builds_among};
use super::test_cases::bytes_response;

/// `GET /test-suites` — every ingested suite with the versions it holds.
///
/// The per-version identity (name, summary, tags, experimental) rides here for the
/// reason the test-case catalog carries its cards' metadata: a listing shows
/// exactly these fields, and without them a client fetches every version of every
/// suite to render a list of rows.
///
/// Experimental versions are omitted unless the deployment has opted in via
/// `TCAB_BACKEND_ALLOW_EXPERIMENTAL`, and a suite left with no visible version is
/// omitted with them — so a client shows what it is served rather than filtering
/// again.
pub async fn list(State(state): State<AppState>) -> Result<Json<SuitesResponse>, ApiError> {
    if state.store.needs_reingest() {
        return Err(ApiError::unavailable(
            "the definition store holds no version in a record format this build can read; \
             re-ingest the catalog",
        ));
    }
    Ok(Json(suite_listing(
        &state.store,
        state.config.allow_experimental,
    )?))
}

/// Build the listing from the store. Split out from [`list`] so the gate and the
/// skip can be covered against a store alone.
fn suite_listing(
    store: &DefinitionStore,
    allow_experimental: bool,
) -> Result<SuitesResponse, ApiError> {
    let mut suites = Vec::new();
    for (slug, versions) in store.list_suites().map_err(ApiError::from)? {
        let mut listed = Vec::new();
        for version in versions {
            let record = match store.read_suite(&slug, &version) {
                Ok(record) => record,
                Err(error) => {
                    // The store is one this build reads, so a record inside it that
                    // does not read back is a defect in what ingest wrote rather
                    // than a state to expect. It costs that version, not the list.
                    tracing::error!(
                        %slug,
                        %version,
                        %error,
                        "skipping a suite version in the listing: its record could not be read"
                    );
                    continue;
                }
            };
            if record.manifest.experimental && !allow_experimental {
                continue;
            }
            listed.push(record.identity());
        }
        if !listed.is_empty() {
            suites.push(SuiteOut {
                slug,
                versions: listed,
            });
        }
    }
    Ok(SuitesResponse {
        test_suites: suites,
    })
}

/// `GET /test-suites/{slug}/{version}` — one suite version's resolved record: its
/// manifest and prose, the changelog, the specifications with their requirements
/// and the validator modules each requirement claims, the definitions, the
/// demonstrations, the reference implementations, the assets and the showcase —
/// alongside the engines with an uploaded reference build and the URL each is
/// played at.
///
/// An experimental version is treated as if it does not exist unless the deployment
/// opted in, exactly as an experimental test-case version is.
pub async fn version(
    State(state): State<AppState>,
    Path((slug, version)): Path<(String, String)>,
) -> Result<Json<SuiteVersionResponse>, ApiError> {
    Ok(Json(suite_version(
        &state.store,
        state.config.allow_experimental,
        &slug,
        &version,
    )?))
}

/// Read one version's record from the store, applying the experimental gate, and
/// fold in its uploaded reference builds. Split out of [`version`] for the reason
/// [`suite_listing`] is: so the gate can be covered against a store alone.
fn suite_version(
    store: &DefinitionStore,
    allow_experimental: bool,
    slug: &str,
    version: &str,
) -> Result<SuiteVersionResponse, ApiError> {
    let record = store.read_suite(slug, version).map_err(ApiError::from)?;
    if record.manifest.experimental && !allow_experimental {
        return Err(ApiError::not_found(format!(
            "test suite `{slug}@{version}` is not ingested"
        )));
    }
    let declared = declared_engines(&record);
    let reference_builds =
        reference_builds_among(store, slug, version, declared.iter().map(String::as_str))?;
    Ok(SuiteVersionResponse {
        digest: store.suite_stamp(slug, version).map(|stamp| stamp.digest),
        suite: record,
        reference_builds,
    })
}

/// `GET /test-suites/{slug}/{version}/showcase/{path...}` — one file of the stored
/// suite version's showcase directory, by the name the record's carousel entries
/// carry. Raw bytes, typed from the file name.
pub async fn showcase_file(
    State(state): State<AppState>,
    Path((slug, version, path)): Path<(String, String, String)>,
) -> Result<Response, ApiError> {
    serve(&state, &slug, &version, "showcase", &path)
}

/// `GET /test-suites/{slug}/{version}/assets/{path...}` — one file of one bundled
/// asset, addressed as `<asset id>/<file>`: the asset's id, which is the last
/// segment of its `dir`, followed by one of the names its manifest declares. Raw
/// bytes, typed from the file name.
pub async fn asset_file(
    State(state): State<AppState>,
    Path((slug, version, path)): Path<(String, String, String)>,
) -> Result<Response, ApiError> {
    serve(&state, &slug, &version, "assets", &path)
}

/// Serve one file of a stored suite version, under a fixed top-level directory.
///
/// The key is resolved inside the stored version and refused if it leaves it, so a
/// caller reaches the showcase and the assets and nothing else — neither another
/// suite's tree nor anything outside the store.
fn serve(
    state: &AppState,
    slug: &str,
    version: &str,
    directory: &str,
    path: &str,
) -> Result<Response, ApiError> {
    let key = format!("{directory}/{path}");
    let bytes = state
        .store
        .read_suite_file(slug, version, &key)
        .map_err(ApiError::from)?;
    Ok(bytes_response(path, bytes))
}

// --- Wire shapes ------------------------------------------------------------

/// `GET /test-suites` — every ingested suite the deployment offers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuitesResponse {
    /// The suites, by slug.
    pub test_suites: Vec<SuiteOut>,
}

/// `GET /test-suites/{slug}/{version}` — one suite version's resolved record, with
/// the reference builds uploaded for it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteVersionResponse {
    /// The stored record, served unmapped.
    #[serde(flatten)]
    pub suite: StoredSuite,
    /// The engines with an uploaded reference build, each with the URL its build is
    /// played at, relative to the backend. An engine the version ships a reference
    /// implementation for but holds no upload of is absent.
    pub reference_builds: std::collections::BTreeMap<String, String>,
    /// The content digest the stored version was ingested from, as lowercase hex
    /// SHA-256, so a client holding the checkout can tell whether the store still
    /// matches it. Absent for a record written before digests were recorded.
    pub digest: Option<String>,
}

/// One suite in the listing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct SuiteOut {
    /// The suite's slug, which is its directory in the suites checkout.
    pub slug: String,
    /// Every visible version, oldest first — so the newest, which is the one a row
    /// describes, is last.
    pub versions: Vec<SuiteVersionIdentity>,
}
