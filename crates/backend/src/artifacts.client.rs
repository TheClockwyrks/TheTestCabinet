//! The backend's reads and writes of what the artifact service keeps for it: each
//! tournament match's replay, a published run's media copied to the public bucket,
//! and a run's code-analysis document (the backend overview's "Durable state" and the
//! public snapshot's "Writing through the artifacts service").
//!
//! Every call goes to the service's **in-cluster** URL
//! ([`Config::artifacts_internal_url`](crate::config::Config::artifacts_internal_url))
//! with the shared control-plane service token, so a client exists only when both are
//! configured ([`ArtifactsClient::from_config`]).

use std::time::Duration;

use reqwest::{StatusCode, Url};
use serde::Deserialize;
use test_cabinet_contracts::backend_api::snapshot::{
    RunAssetOut, RunProofOut, RunShowcaseOut, RunValidationMediaOut,
};
use test_cabinet_suites::test_case::MediaKind;

/// How long one call waits for its answer. A replay or a code-analysis document is
/// bounded by the run upload limit, and a media publish copies object store to object
/// store, so a minute is generous for each while still freeing a caller stuck on an
/// unresponsive service.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Why a call to the artifact service did not succeed.
#[derive(Debug, thiserror::Error)]
pub enum ArtifactsError {
    /// A path segment the call would send is one the service could read as a
    /// different path: empty, `.` or `..`, or holding a separator.
    #[error("`{0}` is not a valid path segment")]
    BadSegment(String),
    /// The service answered a status the call does not accept.
    #[error("the artifact service answered {0}")]
    Refused(StatusCode),
    /// The request never got an answer, or its body could not be read.
    #[error("could not reach the artifact service: {0}")]
    Transport(#[from] reqwest::Error),
}

/// A client of the artifact service's backend routes, presenting the service token.
#[derive(Debug, Clone)]
pub struct ArtifactsClient {
    http: reqwest::Client,
    base: Url,
    token: String,
}

/// What `POST /runs/{id}/publish-media` answers: each kind's entries, pairing the
/// name the run recorded with the public key the file was copied to, in the shapes the
/// run's public document names them by.
#[derive(Default)]
pub struct PublishedMedia {
    /// The proof media, by proof id and kind.
    pub proof_media: Vec<RunProofOut>,
    /// The synthesized validation outputs and the recordings' image store.
    pub validation_media: Vec<RunValidationMediaOut>,
    /// An asset-generation run's produced media.
    pub asset_media: Vec<RunAssetOut>,
    /// The showcase's files.
    pub showcase_media: Vec<RunShowcaseOut>,
}

/// The `publish-media` body as it arrives. The contract's entry shapes are
/// serialize-only, so they are read through these and converted.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishedMediaWire {
    proof_media: Vec<ProofWire>,
    validation_media: Vec<FileWire>,
    asset_media: Vec<FileWire>,
    showcase_media: Vec<FileWire>,
}

/// One `proofMedia` entry.
#[derive(Deserialize)]
struct ProofWire {
    id: String,
    kind: MediaKind,
    key: String,
}

/// One `validationMedia`, `assetMedia` or `showcaseMedia` entry.
#[derive(Deserialize)]
struct FileWire {
    file: String,
    key: String,
}

impl From<PublishedMediaWire> for PublishedMedia {
    fn from(wire: PublishedMediaWire) -> Self {
        Self {
            proof_media: wire
                .proof_media
                .into_iter()
                .map(|p| RunProofOut {
                    id: p.id,
                    kind: p.kind,
                    key: p.key,
                })
                .collect(),
            validation_media: wire
                .validation_media
                .into_iter()
                .map(|f| RunValidationMediaOut {
                    file: f.file,
                    key: f.key,
                })
                .collect(),
            asset_media: wire
                .asset_media
                .into_iter()
                .map(|f| RunAssetOut {
                    file: f.file,
                    key: f.key,
                })
                .collect(),
            showcase_media: wire
                .showcase_media
                .into_iter()
                .map(|f| RunShowcaseOut {
                    file: f.file,
                    key: f.key,
                })
                .collect(),
        }
    }
}

impl ArtifactsClient {
    /// A client of the service at `artifacts_url` presenting `service_token`, or
    /// `None` when either is absent or the URL does not parse: with no service, or no
    /// way to authenticate to it, there is nothing to call.
    pub fn from_config(
        http: reqwest::Client,
        artifacts_url: Option<&str>,
        service_token: Option<&str>,
    ) -> Option<Self> {
        let (Some(base), Some(token)) = (artifacts_url, service_token) else {
            return None;
        };
        let base = match Url::parse(base) {
            Ok(base) if !base.cannot_be_a_base() => base,
            _ => {
                tracing::warn!(url = %base, "TCAB_ARTIFACTS_URL is not a base URL");
                return None;
            }
        };
        Some(Self {
            http,
            base,
            token: token.to_string(),
        })
    }

    /// `PUT /tournaments/{id}/matches/{matchId}/replay`: store a match's replay,
    /// replacing one already stored for the match.
    pub async fn put_match_replay(
        &self,
        tournament_id: &str,
        match_id: &str,
        replay: Vec<u8>,
    ) -> Result<(), ArtifactsError> {
        let url = self.url(&["tournaments", tournament_id, "matches", match_id, "replay"])?;
        let response = self
            .http
            .put(url)
            .bearer_auth(&self.token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(replay)
            .timeout(CALL_TIMEOUT)
            .send()
            .await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(ArtifactsError::Refused(response.status()))
        }
    }

    /// `GET /tournaments/{id}/matches/{matchId}/replay`: a match's stored replay, or
    /// `None` when the service holds none for it.
    pub async fn match_replay(
        &self,
        tournament_id: &str,
        match_id: &str,
    ) -> Result<Option<Vec<u8>>, ArtifactsError> {
        let url = self.url(&["tournaments", tournament_id, "matches", match_id, "replay"])?;
        self.get_bytes(url).await
    }

    /// `POST /runs/{id}/publish-media`: have the service copy run `run_id`'s
    /// publishable media from its stored tree to the public bucket, and answer the keys
    /// it was copied to. `None` when the service holds no tree, or no record, for the
    /// run. The copy is idempotent, so a repeat answers the same keys.
    pub async fn publish_run_media(
        &self,
        run_id: &str,
    ) -> Result<Option<PublishedMedia>, ArtifactsError> {
        let url = self.url(&["runs", run_id, "publish-media"])?;
        let response = self
            .http
            .post(url)
            .bearer_auth(&self.token)
            .timeout(CALL_TIMEOUT)
            .send()
            .await?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(None),
            status if status.is_success() => {
                let wire: PublishedMediaWire = response.json().await?;
                Ok(Some(wire.into()))
            }
            status => Err(ArtifactsError::Refused(status)),
        }
    }

    /// `GET /runs/{id}/code-analysis`: run `run_id`'s code-analysis document as the
    /// service answers it, or `None` when its tree holds none. The service serves the
    /// document gzip-framed when it is stored that way, and this client decodes no
    /// content encoding, so the bytes are gzip or plain JSON and the caller tells them
    /// apart by the gzip magic.
    pub async fn run_code_analysis(&self, run_id: &str) -> Result<Option<Vec<u8>>, ArtifactsError> {
        let url = self.url(&["runs", run_id, "code-analysis"])?;
        self.get_bytes(url).await
    }

    /// `GET url` with the token: the body, `None` for a `404`, and an error for any
    /// other status. A `302` to a signed object-store URL is followed.
    async fn get_bytes(&self, url: Url) -> Result<Option<Vec<u8>>, ArtifactsError> {
        let response = self
            .http
            .get(url)
            .bearer_auth(&self.token)
            .timeout(CALL_TIMEOUT)
            .send()
            .await?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(None),
            status if status.is_success() => Ok(Some(response.bytes().await?.to_vec())),
            status => Err(ArtifactsError::Refused(status)),
        }
    }

    /// The service URL of the path `segments`, each appended to the base as one
    /// percent-encoded segment. A segment the service could resolve as another path is
    /// refused rather than sent.
    fn url(&self, segments: &[&str]) -> Result<Url, ArtifactsError> {
        if let Some(bad) = segments
            .iter()
            .find(|segment| !crate::store::is_safe_segment(segment))
        {
            return Err(ArtifactsError::BadSegment((*bad).to_string()));
        }
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map_err(|()| ArtifactsError::BadSegment(self.base.to_string()))?
            .pop_if_empty()
            .extend(segments);
        Ok(url)
    }
}
