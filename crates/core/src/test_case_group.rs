//! Test-case groups: the repo-defined sets of related cases the home page
//! presents.
//!
//! See `docs/components/core/test-case-groups.md`. A test-case group is a
//! global, ordered set of related test-case or game-jam slugs — the
//! tower-defense cases, say — and it exists for presentation: the home page
//! renders one cross-case leaderboard per group. It is **not** a case's `tags`
//! (which classify one case for filtering) and it is **not** the per-account
//! "case group" of the console's coverage plans (which schedules a reviewer's
//! runs); to keep the three apart, nothing here uses the bare word "group".
//!
//! Like the [test-case catalog](crate::test_case::TestCaseCatalog) — and unlike
//! an [engine](crate::engine), whose manifests are embedded at build time — the
//! catalogue is **walked from disk at run time**: a group is a directory under
//! `test-case-groups/<slug>/` holding one `test-case-group.toml`, so authoring
//! a group is a manifest edit with no rebuild. The backend ingests the set into
//! its definition store on a whole-catalog scan, so a backend-driven deployment
//! serves the same set a local checkout resolves.
//!
//! This module owns the manifest's shape and its self-contained validation.
//! What it deliberately does **not** validate is membership: a member slug must
//! resolve in the test-case catalog (cases and jams alike), and that
//! cross-check lives where a [`TestCaseCatalog`](crate::test_case::TestCaseCatalog)
//! is in hand — the backend's ingest step, and the repository's
//! `manifests_are_valid` test.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::test_case::is_valid_slug;

/// The manifest file name inside a test-case-group directory.
pub const MANIFEST_FILE: &str = "test-case-group.toml";

/// A test-case group's manifest, authored as `test-case-group.toml`.
///
/// Unknown keys are rejected rather than ignored. A manifest is authored by
/// hand, so a misspelled key is a mistake that should be a loud failure at load
/// rather than a field that silently does nothing.
///
/// `Serialize` is derived because the set is *data that travels*: the backend
/// writes the ingested set into its definition store as JSON and reads it back
/// through this same shape, so the store and the loader cannot drift apart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub struct TestCaseGroup {
    /// Stable slug, matching the directory the manifest lives in
    /// ([`is_valid_slug`]).
    pub slug: String,
    /// Human-readable display name, heading the group's home-page leaderboard.
    pub name: String,
    /// Optional one-line description, for display beside the name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Optional ordering key. Groups sort by rank ascending, then by name, and
    /// ranked groups precede unranked ones — see `display_order`. The rank is
    /// applied where the catalogue is listed and does not ride the API wire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rank: Option<u32>,
    /// The ordered member test-case/game-jam slugs. Non-empty and free of
    /// duplicates; each must resolve in the test-case catalog (checked by the
    /// callers that hold one, not here).
    pub cases: Vec<String>,
}

/// Walks and validates the `test-case-groups/` catalogue on disk.
#[derive(Debug, Clone)]
pub struct TestCaseGroupCatalog {
    /// Root of the catalogue (the `test-case-groups/` directory).
    root: PathBuf,
}

impl TestCaseGroupCatalog {
    /// Open a catalogue rooted at the given `test-case-groups/` directory.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The catalogue root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Load every test-case group, already in display order (rank ascending,
    /// then name; unranked after ranked).
    ///
    /// An unreadable root is an error, like the test-case catalog's: pointing
    /// the catalogue at a directory that is not there is a configuration
    /// mistake, not an empty set. A single malformed manifest fails the whole
    /// list for the same reason a malformed case does — the set is loaded at a
    /// gate (ingest, the CLI listing, the repo test), where a partial answer
    /// would read as a complete one.
    pub fn list(&self) -> Result<Vec<TestCaseGroup>> {
        let mut groups = Vec::new();
        // Non-directory and hidden entries are ignored, so the folder's README
        // and a stray `.DS_Store` never derail discovery — the same tolerance
        // the test-case catalog's walk has.
        for dir in subdir_names(&self.root)? {
            groups.push(self.load(&dir)?);
        }
        groups.sort_by(display_order);
        Ok(groups)
    }

    /// Load and validate one group directory's manifest.
    fn load(&self, dir: &str) -> Result<TestCaseGroup> {
        let path = self.root.join(dir).join(MANIFEST_FILE);
        let raw = fs::read_to_string(&path).map_err(|err| {
            Error::TestCaseGroup(format!(
                "test-case group `{dir}`: could not read {MANIFEST_FILE}: {err}"
            ))
        })?;
        let group: TestCaseGroup = toml::from_str(&raw).map_err(|err| {
            Error::TestCaseGroup(format!(
                "test-case group `{dir}`: invalid {MANIFEST_FILE}: {err}"
            ))
        })?;
        validate(dir, &group)?;
        Ok(group)
    }
}

/// Display order: rank ascending, then name, with unranked groups after ranked
/// ones. The trailing slug comparison only breaks a tie between two groups with
/// the same display name, keeping the order fully deterministic.
fn display_order(a: &TestCaseGroup, b: &TestCaseGroup) -> std::cmp::Ordering {
    // `None` must sort *after* every rank, which is the opposite of
    // `Option<u32>`'s derived order (`None` first), so compare presence first.
    a.rank
        .is_none()
        .cmp(&b.rank.is_none())
        .then_with(|| a.rank.cmp(&b.rank))
        .then_with(|| a.name.cmp(&b.name))
        .then_with(|| a.slug.cmp(&b.slug))
}

/// The invariants every group manifest must hold, checked once at load. Unlike
/// an engine's embedded manifest these are read from disk at run time, so a
/// violation is an [`Error::TestCaseGroup`] rather than a panic.
fn validate(dir: &str, group: &TestCaseGroup) -> Result<()> {
    let invalid = |detail: String| {
        Err(Error::TestCaseGroup(format!(
            "test-case group `{dir}`: {detail}"
        )))
    };
    // The slug must match the folder: unlike a test case — whose identity is
    // decoupled from its folder so published runs survive a rename — nothing
    // records a group slug, so the two-names ambiguity buys nothing.
    if group.slug != dir {
        return invalid(format!(
            "manifest declares slug `{}` but lives in the `{dir}` directory",
            group.slug
        ));
    }
    if !is_valid_slug(&group.slug) {
        return invalid(format!(
            "slug `{}` is not a valid slug (lowercase letters, digits, and single \
             hyphens between them)",
            group.slug
        ));
    }
    if group.name.trim().is_empty() {
        return invalid("declares an empty name".to_string());
    }
    if group
        .summary
        .as_deref()
        .is_some_and(|summary| summary.trim().is_empty())
    {
        return invalid("declares an empty summary; omit the key instead".to_string());
    }
    if group.cases.is_empty() {
        return invalid(
            "declares no member cases; a group exists to present its members, so an \
             empty one presents nothing"
                .to_string(),
        );
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for member in &group.cases {
        // Shape only. Whether the slug resolves is checked where a
        // `TestCaseCatalog` is in hand (module docs), but a member that is not
        // even slug-shaped can never resolve, so it is refused here with the
        // group named.
        if !is_valid_slug(member) {
            return invalid(format!(
                "member `{member}` is not a valid slug (lowercase letters, digits, and \
                 single hyphens between them)"
            ));
        }
        if !seen.insert(member.as_str()) {
            return invalid(format!("member `{member}` is listed more than once"));
        }
    }
    Ok(())
}

/// Read the immediate subdirectory names of the catalogue root, sorted,
/// ignoring files and hidden entries.
fn subdir_names(root: &Path) -> Result<Vec<String>> {
    let entries = fs::read_dir(root).map_err(|err| {
        Error::TestCaseGroup(format!(
            "could not read test-case-groups directory {}: {err}",
            root.display()
        ))
    })?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| {
            Error::TestCaseGroup(format!(
                "could not read test-case-groups directory {}: {err}",
                root.display()
            ))
        })?;
        if !entry.path().is_dir() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str()
            && !name.starts_with('.')
        {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

#[cfg(test)]
#[path = "test_case_group.test.rs"]
mod tests;
