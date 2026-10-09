//! What a suite validator run is handed and what it reports: the environment a
//! validator project reads, and the outcome of each requirement a run's
//! specifications declare.
//!
//! A run record's validation summary carries the outcomes, so they are contract.
//! The runner that executes a version's validator project and builds them lives in
//! `test_cabinet_core::test_suite`.

use serde::{Deserialize, Serialize};

use super::model::SuiteRequirementKind;

/// The environment variable naming the base URL the produced build is served at.
///
/// The port is bound at run time, so the project cannot know it in advance. A
/// project run standalone from its own directory finds the variable absent and falls
/// back to the local development URL its own config names, which is how an author
/// drives the same validators against a build they are serving themselves.
pub const VALIDATOR_BASE_URL_ENV: &str = "TCAB_VALIDATOR_BASE_URL";

/// The environment variable naming the `globalThis` property the debug API root is
/// reached by: the `handle` the version's `debug-api.toml` declares.
///
/// Passed rather than compiled in so the project reads its own suite's handle. A
/// version declaring no debug API sets nothing, and the variable is absent.
pub const DEBUG_API_HANDLE_ENV: &str = "TCAB_DEBUG_API_HANDLE";

/// How a requirement was decided for one run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum RequirementStatus {
    /// Every validator the requirement claims ran, and every assertion they
    /// returned passed.
    Passed,
    /// A validator the requirement claims returned a failed assertion, raised, or
    /// reported no assertion at all.
    Failed,
    /// Nothing decided the requirement. Either the runner could not execute the
    /// validator project — including a run stopped at its cap, which is a fact about
    /// the host rather than about the build — or the requirement is non-functional
    /// and is judged by review.
    Undecided,
}

/// One assertion a validator returned, as the validator stated it.
///
/// Retaining each assertion rather than a single verdict is what lets a console show
/// the conditions that ran: an implementation satisfying two of a validator's three
/// conditions is visibly different from one satisfying none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RequirementAssertion {
    /// What the assertion checks, phrased so it reads true when it passes.
    pub name: String,
    /// Whether the condition held.
    pub passed: bool,
    /// The explanation the validator supplied for a failure, when it supplied one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}

/// What one requirement of the specifications a test case covers came to for one
/// run.
///
/// Keyed by the requirement's suite-wide identity, `<specification id>/<requirement
/// id>` — the same form the seeded specification document writes each requirement
/// under, so a reader of the document and a reader of a result name the same thing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct RequirementOutcome {
    /// The requirement's suite-wide identity: `<specification id>/<requirement id>`.
    pub id: String,
    /// The id of the specification declaring the requirement.
    pub specification: String,
    /// The requirement's own id, unique within its specification.
    pub requirement: String,
    /// Whether the requirement is decided by validators or by review.
    pub kind: SuiteRequirementKind,
    /// What the validators decided, or that nothing did.
    pub status: RequirementStatus,
    /// The validator module paths the requirement claims, relative to `validators/`,
    /// in the order it lists them. Empty for a non-functional requirement, which
    /// claims none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validators: Vec<String>,
    /// Every assertion the claimed validators returned, in validator order. Empty
    /// when nothing ran.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assertions: Vec<RequirementAssertion>,
    /// Why the requirement is not decided by its assertions alone: a validator that
    /// raised, a validator the project reported nothing for, the reason the project
    /// could not be run, or the note that review decides this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}
