//! The committed **reference-build lockfile** — the pull-model record of where each
//! test-case variant's [reference implementation](crate::test_case) is deployed.
//!
//! A reference implementation is the authored, correct static build of a case
//! variant. `tcab publish-reference` builds it, deploys it to Cloudflare Pages, and
//! reads the served URL back from `wrangler`. That URL is not knowable up front
//! (Cloudflare truncates long subdomains), so it is captured and **committed** here
//! rather than pushed to the backend — the remote backends are private (VPN-only),
//! so nothing off-cluster can reach them. The backend instead **ingests** this file
//! from its own git checkout (the same pull path `scripts/reingest-cluster.sh`
//! drives), reconciling its `case_reference_build` table to the entries for its
//! environment.
//!
//! The file is keyed by **environment first** (`prod`/`staging`/…): prod and staging
//! deploy to different Pages projects, so a variant has a different URL per
//! environment, and both are held here so the single committed file serves both
//! backends. Each backend selects its own environment (`TCAB_ENV`) and ignores the
//! rest. Every map is a [`BTreeMap`], so the serialized JSON is sorted and its diffs
//! are stable.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// The filename, relative to the test-cases catalog root, the CLI writes and the
/// backend reads. It lives beside the catalog (not under a version folder) because
/// its entries span every case, version, and environment.
pub const REFERENCE_LOCK_FILENAME: &str = "reference-builds.lock.json";

/// One deployed reference build: the served URL for a `(slug, version, variant)`
/// triple in a single environment. The flattened shape [`ReferenceLock`] hands the
/// backend to reconcile its table against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceBuildEntry {
    /// The case's slug (its manifest identity, not the folder name).
    pub slug: String,
    /// The exact, immutable case version (for example `v1.1.0`).
    pub version: String,
    /// The variant slug (for example `base`).
    pub variant: String,
    /// The served reference-build URL, as read back from `wrangler`.
    pub url: String,
}

/// One environment's deployed references: `slug → version → variant → url`. Every
/// level is a [`BTreeMap`] so the serialized keys stay sorted for stable diffs.
type CaseUrls = BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>>;

/// The committed reference-build lockfile: `env → slug → version → variant → url`.
///
/// Serialized transparently as the environment map, so the on-disk JSON is exactly
/// that nesting with no wrapper object.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ReferenceLock {
    /// `env → `[`CaseUrls`]. Keyed by environment first (prod/staging/…) so a single
    /// committed file serves every backend.
    envs: BTreeMap<String, CaseUrls>,
}

impl ReferenceLock {
    /// Load the lockfile at `path`, or `Ok(None)` when the file does not exist.
    ///
    /// A missing file is distinct from an empty one: it means the lockfile has not
    /// been committed yet, so a reader must **not** treat it as "no references"
    /// (which would prune every recorded build). A present-but-malformed file is a
    /// hard error rather than a silent empty.
    pub fn load(path: &Path) -> std::io::Result<Option<Self>> {
        match std::fs::read(path) {
            Ok(bytes) => {
                let lock = serde_json::from_slice(&bytes)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
                Ok(Some(lock))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err),
        }
    }

    /// Write the lockfile to `path` as pretty-printed, sorted JSON with a trailing
    /// newline (so it reads and diffs cleanly as a committed file).
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let mut json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        json.push('\n');
        std::fs::write(path, json)
    }

    /// Record (or overwrite) the deployed URL for one triple in one environment.
    /// Intermediate maps are created as needed.
    pub fn set(&mut self, env: &str, slug: &str, version: &str, variant: &str, url: &str) {
        self.envs
            .entry(env.to_string())
            .or_default()
            .entry(slug.to_string())
            .or_default()
            .entry(version.to_string())
            .or_default()
            .insert(variant.to_string(), url.to_string());
    }

    /// The complete set of deployed reference builds for `env`, flattened for the
    /// backend's table reconcile — or `None` when `env` is **absent** from the file.
    ///
    /// The `None`/`Some(empty)` distinction is deliberate: an absent environment key
    /// means "not populated for this env yet" (the reader should leave its table
    /// alone), whereas a present-but-empty map means "this env has no references"
    /// (the reader should reconcile to empty, pruning any it holds).
    pub fn entries_for_env(&self, env: &str) -> Option<Vec<ReferenceBuildEntry>> {
        let cases = self.envs.get(env)?;
        let mut entries = Vec::new();
        for (slug, versions) in cases {
            for (version, variants) in versions {
                for (variant, url) in variants {
                    entries.push(ReferenceBuildEntry {
                        slug: slug.clone(),
                        version: version.clone(),
                        variant: variant.clone(),
                        url: url.clone(),
                    });
                }
            }
        }
        Some(entries)
    }
}

#[cfg(test)]
#[path = "reference_lock.test.rs"]
mod tests;
