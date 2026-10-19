//! Test support for publishing: a transcoder that runs no program, and the
//! run record the publish tests store.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use test_cabinet_contracts::metrics::{Cost, RunMetrics, TokenCounts};
use test_cabinet_contracts::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunShowcase, RunState, RunStatus, RunSubject,
    RunTooling,
};
use test_cabinet_contracts::validation::ValidationSummary;

/// The run the publish tests store.
pub(crate) const RUN: &str = "run-1";

/// A completed run record with `validation` and `showcase`.
pub(crate) fn record(validation: ValidationSummary, showcase: Option<RunShowcase>) -> RunRecord {
    RunRecord {
        id: RUN.to_string(),
        started_at: "2026-06-14T10:00:00Z".to_string(),
        finished_at: "2026-06-14T10:05:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: test_cabinet_contracts::test_case::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            orchestrator_slug: "one-shot".to_string(),
            engine_slug: "none".to_string(),
            engine_version: None,
            model_id: "anthropic/claude-opus-4".to_string(),
            gg_capability_set: None,
            gg_summary: None,
        },
        tooling: RunTooling {
            test_cabinet_commit: None,
        },
        environment: RunEnvironment {
            os: "linux".to_string(),
            container_image: "img:latest".to_string(),
            node_version: None,
            auth_mode: test_cabinet_contracts::run_record::AuthMode::ApiKey,
        },
        metrics: RunMetrics {
            run_time_seconds: 1.0,
            tokens: TokenCounts {
                uncached_input: Some(0),
                cached_input: Some(0),
                output: Some(0),
                reasoning: Some(0),
            },
            cost: Cost {
                comparable: Some(0.0),
                actual: Some(0.0),
            },
            ..RunMetrics::default()
        },
        validation,
        links: RunLinks {
            source_repo: None,
            playable_build: None,
        },
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
        tool_calls: Default::default(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
        showcase,
    }
}

/// A [`Transcoder`](super::Transcoder) that "transcodes" by writing `mp4:`
/// followed by the input's bytes, or fails every time, and counts its runs.
#[derive(Debug, Default)]
pub(crate) struct FakeTranscoder {
    /// Whether every transcode fails.
    pub(crate) failing: bool,
    /// How many transcodes were asked for.
    pub(crate) runs: AtomicUsize,
}

impl FakeTranscoder {
    /// A transcoder whose every run succeeds.
    pub(crate) fn working() -> Self {
        Self::default()
    }

    /// A transcoder whose every run fails.
    pub(crate) fn failing() -> Self {
        Self {
            failing: true,
            ..Self::default()
        }
    }

    /// How many transcodes were asked for.
    pub(crate) fn runs(&self) -> usize {
        self.runs.load(Ordering::SeqCst)
    }
}

#[async_trait::async_trait]
impl super::Transcoder for FakeTranscoder {
    async fn webm_to_mp4(&self, input: &Path, output: &Path) -> bool {
        self.runs.fetch_add(1, Ordering::SeqCst);
        if self.failing {
            return false;
        }
        let Ok(raw) = tokio::fs::read(input).await else {
            return false;
        };
        let mut mp4 = b"mp4:".to_vec();
        mp4.extend_from_slice(&raw);
        tokio::fs::write(output, mp4).await.is_ok()
    }
}
