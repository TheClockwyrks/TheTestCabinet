//! Adversarial arena commands: quick (transient) head-to-head matches and
//! persisted tournaments, run in-process through the shared
//! [`match_play`](test_cabinet_core::match_play) machinery.
//!
//! Controllers are resolved **local-only** (the decided scope): a baseline from
//! the case's committed `references/<id>.wasm` (read straight from the local
//! checkout, or fetched from the backend when one is configured), a prior run's
//! module from this host's run output dir. A quick match produces a replay for
//! immediate playback and persists nothing; a tournament writes its record and
//! per-match replays to the local store and — when a backend is configured —
//! publishes them so the gallery can show it.

use std::path::Path;

use foray_core::replay::Replay;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use std::collections::HashSet;

use test_cabinet_core::match_play::{
    ARENA_OPPONENT_IDS, ControllerKind, ControllerRef, MatchSummary, ResolvedController,
    TournamentRecord, resolve_baseline, run_quick_match, run_tournament,
};
use test_cabinet_core::{BackendClient, HttpBackendClient, TestCaseVersion};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::commands::resolve_version_inner;
use crate::config;

/// A command result whose error is a plain string the webview renders.
type CmdResult<T> = Result<T, String>;

fn cmd_err<E: std::fmt::Display>(context: &str, e: E) -> String {
    format!("{context}: {e}")
}

/// Reject an id unsafe to use as a path segment (a run id names a directory).
fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id != "." && id != ".." && !id.contains('/') && !id.contains('\\')
}

/// Resolve one controller's wasm bytes for `test_case` (baseline from the case's
/// `references/`, run from this host's output dir).
async fn resolve_controller(
    controller: &ControllerRef,
    test_case: &TestCaseVersion,
    slug: &str,
    version: &str,
) -> CmdResult<ResolvedController> {
    if !is_safe_id(&controller.id) {
        return Err(format!("invalid controller id `{}`", controller.id));
    }
    let wasm = match controller.kind {
        ControllerKind::Baseline => {
            // The arena offers the hidden references (e.g. `fuel-probe`) as well as
            // the model-facing baselines, so resolve against the wider arena set.
            if !ARENA_OPPONENT_IDS.contains(&controller.id.as_str()) {
                return Err(format!("unknown baseline `{}`", controller.id));
            }
            match config::backend_url() {
                // A backend-resolved version's references are not materialized to
                // disk, so fetch the baseline module from the backend.
                Some(url) => {
                    let source = format!("references/{}.wasm", controller.id);
                    HttpBackendClient::new(url)
                        .artifact(slug, version, Path::new(&source))
                        .await
                        .map_err(|e| cmd_err("fetching baseline", e))?
                        .bytes
                }
                // The local checkout holds the baseline beside the case.
                None => resolve_baseline(test_case, &controller.id)
                    .map_err(|e| cmd_err("reading baseline", e))?,
            }
        }
        ControllerKind::Run => {
            let module_rel = test_case
                .build
                .as_ref()
                .and_then(|build| build.module.as_ref())
                .ok_or_else(|| "the case declares no build.module".to_string())?;
            let path = config::output_dir()
                .join(&controller.id)
                .join("implementation")
                .join(module_rel);
            std::fs::read(&path).map_err(|e| {
                cmd_err(
                    &format!("reading controller for run `{}`", controller.id),
                    e,
                )
            })?
        }
        ControllerKind::PushedRun => {
            // A pushed run's controller lives on the backend (uploaded at push), so
            // any host can resolve it even without having produced it locally.
            let url = config::backend_url().ok_or_else(|| {
                "no backend configured to resolve a pushed controller".to_string()
            })?;
            HttpBackendClient::new(url)
                .controller_artifact(&controller.id)
                .await
                .map_err(|e| cmd_err("fetching pushed controller", e))?
        }
    };
    Ok(ResolvedController {
        controller: controller.clone(),
        wasm,
    })
}

/// The configuration for a quick (transient) head-to-head match.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchConfig {
    pub test_case: String,
    pub version: String,
    pub red: ControllerRef,
    pub blue: ControllerRef,
}

/// The result of a quick match: the replay (for immediate playback) and summary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchResultDto {
    /// The browser-playable replay, or `null` when a controller failed to load.
    pub replay: Option<Replay>,
    pub summary: MatchSummary,
}

/// Run one head-to-head match between two chosen controllers and return its
/// replay + summary. Transient: nothing is persisted.
#[tauri::command]
#[tracing::instrument(skip_all, fields(test_case = %config.test_case, version = %config.version))]
pub async fn run_adversarial_match(config: MatchConfig) -> CmdResult<MatchResultDto> {
    let test_case = resolve_version_inner(&config.test_case, &config.version).await?;
    let red =
        resolve_controller(&config.red, &test_case, &config.test_case, &config.version).await?;
    let blue =
        resolve_controller(&config.blue, &test_case, &config.test_case, &config.version).await?;

    // A match is CPU-bound wasm execution; run it off the async runtime.
    let outcome = tokio::task::spawn_blocking(move || run_quick_match(&test_case, &red, &blue))
        .await
        .map_err(|e| cmd_err("match task panicked", e))?
        .map_err(|e| cmd_err("running the match", e))?;
    Ok(MatchResultDto {
        replay: outcome.replay,
        summary: outcome.summary,
    })
}

/// List the controllers available to pit for a case: the committed arena opponents
/// (model-facing baselines plus the hidden references), this host's produced
/// adversarial runs (labelled by model id), and the case's **pushed** adversarial
/// controllers from the backend (so a pushed implementation is selectable even when
/// this host did not produce it).
#[tauri::command]
#[tracing::instrument(fields(%slug))]
pub async fn list_adversarial_controllers(
    slug: String,
    _version: String,
) -> CmdResult<Vec<ControllerRef>> {
    let mut controllers: Vec<ControllerRef> = ARENA_OPPONENT_IDS
        .iter()
        .map(|id| ControllerRef {
            id: id.to_string(),
            kind: ControllerKind::Baseline,
            label: None,
        })
        .collect();

    let dir = config::output_dir();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path().join("run-record.json")) else {
                continue;
            };
            let Ok(record) = serde_json::from_str::<test_cabinet_core::RunRecord>(&text) else {
                continue;
            };
            if record.subject.test_case_slug != slug || record.validation.adversarial.is_none() {
                continue;
            }
            controllers.push(ControllerRef {
                id: record.id.clone(),
                kind: ControllerKind::Run,
                label: Some(record.subject.model_id.clone()),
            });
        }
    }

    // Merge the case's pushed controllers from the backend (when one is
    // configured), skipping any already present as a local run.
    if let Some(url) = config::backend_url()
        && let Ok(pushed) = HttpBackendClient::new(url).list_adversarial_controllers(&slug).await
    {
        let known: HashSet<String> = controllers.iter().map(|c| c.id.clone()).collect();
        for controller in pushed {
            if !known.contains(&controller.id) {
                controllers.push(controller);
            }
        }
    }

    Ok(controllers)
}

/// The configuration for a tournament.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentConfig {
    pub test_case: String,
    pub version: String,
    #[serde(default)]
    pub variant: String,
    pub participants: Vec<ControllerRef>,
}

/// One completed match, emitted live on `tournament://<id>/progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TournamentProgress {
    played: usize,
    total: usize,
    summary: MatchSummary,
}

/// The terminal outcome of a tournament, emitted on `tournament://<id>/done`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum TournamentOutcome {
    Completed { record: Box<TournamentRecord> },
    Failed { message: String },
}

/// The Tauri event channel carrying a tournament's live per-match progress.
fn progress_channel(id: &str) -> String {
    format!("tournament://{id}/progress")
}

/// The Tauri event channel carrying a tournament's terminal outcome.
fn done_channel(id: &str) -> String {
    format!("tournament://{id}/done")
}

/// Run a tournament over the chosen participants. Returns immediately with the
/// tournament id; the field runs on a background task that emits per-match progress
/// on `tournament://<id>/progress`, writes the record + replays to the local store,
/// publishes to the backend when one is configured, and emits the terminal outcome
/// on `tournament://<id>/done`.
#[tauri::command]
#[tracing::instrument(skip_all, fields(test_case = %config.test_case, participants = config.participants.len()))]
pub async fn run_tournament_match(app: AppHandle, config: TournamentConfig) -> CmdResult<String> {
    if config.participants.len() < 2 {
        return Err("a tournament needs at least two participants".to_string());
    }
    let test_case = resolve_version_inner(&config.test_case, &config.version).await?;

    // Resolve every controller up front so a bad participant fails synchronously.
    let mut participants: Vec<ResolvedController> = Vec::with_capacity(config.participants.len());
    for controller in &config.participants {
        participants.push(
            resolve_controller(controller, &test_case, &config.test_case, &config.version).await?,
        );
    }

    let tournament_id = uuid::Uuid::new_v4().to_string();
    let variant = if config.variant.trim().is_empty() {
        "base".to_string()
    } else {
        config.variant.clone()
    };

    let returned_id = tournament_id.clone();
    tokio::spawn(async move {
        let created_at = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_default();
        let progress_app = app.clone();
        let progress = progress_channel(&tournament_id);
        let blocking_id = tournament_id.clone();
        let build = tokio::task::spawn_blocking(move || {
            run_tournament(
                &test_case,
                &variant,
                &blocking_id,
                &created_at,
                participants,
                |played, total, summary| {
                    let _ = progress_app.emit(
                        &progress,
                        TournamentProgress {
                            played,
                            total,
                            summary: summary.clone(),
                        },
                    );
                },
            )
        })
        .await;

        let done = done_channel(&tournament_id);
        let build = match build {
            Ok(Ok(build)) => build,
            Ok(Err(e)) => {
                let _ = app.emit(
                    &done,
                    TournamentOutcome::Failed {
                        message: cmd_err("running the tournament", e),
                    },
                );
                return;
            }
            Err(e) => {
                let _ = app.emit(
                    &done,
                    TournamentOutcome::Failed {
                        message: cmd_err("tournament task panicked", e),
                    },
                );
                return;
            }
        };

        if let Err(message) = persist_and_publish(&tournament_id, &build).await {
            let _ = app.emit(&done, TournamentOutcome::Failed { message });
            return;
        }

        let _ = app.emit(
            &done,
            TournamentOutcome::Completed {
                record: Box::new(build.record),
            },
        );
    });

    Ok(returned_id)
}

/// Write a finished tournament to the local store and, when a backend is
/// configured, publish the record and each match's replay to it.
async fn persist_and_publish(
    tournament_id: &str,
    build: &test_cabinet_core::match_play::TournamentBuild,
) -> Result<(), String> {
    let dir = config::output_dir().join("tournaments").join(tournament_id);
    std::fs::create_dir_all(&dir).map_err(|e| cmd_err("creating tournament dir", e))?;
    let record_json = serde_json::to_string_pretty(&build.record)
        .map_err(|e| cmd_err("serializing tournament", e))?;
    std::fs::write(dir.join("tournament.json"), record_json)
        .map_err(|e| cmd_err("writing tournament record", e))?;
    for (match_id, replay) in &build.replays {
        let match_dir = dir.join("matches").join(match_id);
        std::fs::create_dir_all(&match_dir).map_err(|e| cmd_err("creating match dir", e))?;
        std::fs::write(match_dir.join("replay.json"), replay.to_json())
            .map_err(|e| cmd_err("writing match replay", e))?;
    }

    if let Some(url) = config::backend_url() {
        let client = HttpBackendClient::new(url);
        client
            .publish_tournament(&build.record)
            .await
            .map_err(|e| cmd_err("publishing the tournament", e))?;
        for (match_id, replay) in &build.replays {
            client
                .publish_tournament_match(tournament_id, match_id, replay.to_json().into_bytes())
                .await
                .map_err(|e| cmd_err("publishing a match replay", e))?;
        }
    }
    Ok(())
}

/// List the tournaments this host has run, newest first (by `createdAt`).
#[tauri::command]
#[tracing::instrument]
pub fn list_tournaments() -> CmdResult<Vec<TournamentRecord>> {
    let dir = config::output_dir().join("tournaments");
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(cmd_err("reading tournaments directory", e)),
    };
    let mut tournaments = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path().join("tournament.json")) else {
            continue;
        };
        if let Ok(record) = serde_json::from_str::<TournamentRecord>(&text) {
            tournaments.push(record);
        }
    }
    tournaments.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(tournaments)
}

/// Read one tournament this host has run by its id.
#[tauri::command]
#[tracing::instrument(fields(%id))]
pub fn read_tournament(id: String) -> CmdResult<TournamentRecord> {
    let path = config::output_dir()
        .join("tournaments")
        .join(&id)
        .join("tournament.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| cmd_err(&format!("reading tournament `{id}`"), e))?;
    serde_json::from_str(&text).map_err(|e| cmd_err("parsing tournament record", e))
}
