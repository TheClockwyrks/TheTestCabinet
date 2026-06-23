//! Building a subscription credential source from an operator-provided Secret.
//!
//! The driver runs in an ephemeral pod with no signed-in host home, so it cannot
//! read the subscription credential files the CLI/desktop path reads from `~`.
//! Instead, the dispatcher mounts an operator-provided Secret (one shared
//! subscription per deployment) into the driver pod as a read-only volume, and the
//! driver turns that mount into a [`MapCreds`] keyed by each credential's full
//! container path. Core's [`resolve_auth_with`] then draws the subscription bytes
//! from this map instead of the host filesystem, with the *same* mode-selection
//! policy — the driver never decides the mode.
//!
//! ## The basename mapping
//!
//! A Kubernetes Secret's keys must be valid data keys, not absolute paths, so the
//! Secret is keyed by each credential's **basename** (for example `auth.json`,
//! `.credentials.json`). When the Secret is mounted, the kubelet projects one file
//! per key at `<dir>/<key>`. The driver maps each key back to the harness's full
//! [`CredFile::container_path`] (for example `/home/node/.codex/auth.json`) so the
//! resulting [`MapCreds`] is keyed the way [`resolve_auth_with`] looks it up.
//!
//! This reads **only** the mounted directory — never the host home (`~`) — so it
//! works in a pod and a unit test alike (point `HOME`/`CODEX_HOME` at nothing and
//! it still succeeds purely from the mount).
//!
//! Required-ness is **not** enforced here: an absent file is simply not added to
//! the map, and core fails the run if a *required* credential is missing — keeping
//! a single source of truth for which files a subscription needs.
//!
//! [`resolve_auth_with`]: test_cabinet_core::resolve_auth_with
//! [`CredFile::container_path`]: test_cabinet_core::CredFile

use std::path::Path;

use test_cabinet_core::run_record::HarnessSlug;
use test_cabinet_core::{DefaultHarnessRegistry, HarnessRegistry, MapCreds};

/// Build a [`MapCreds`] for `harness_slug` from the subscription Secret mounted at
/// `dir`. Each of the harness's subscription credential files is read from
/// `dir.join(basename(container_path))` when present and keyed in the map by its
/// full `container_path`; an absent file is skipped (core enforces required-ness).
///
/// Reads only `dir` — never the host home — so a missing or non-subscription
/// harness simply yields an empty map (and core then reports the run as
/// unavailable when subscription auth is required).
pub fn mounted_creds(dir: &Path, harness_slug: HarnessSlug) -> MapCreds {
    let registry = DefaultHarnessRegistry::new();
    let Some(harness) = registry.get(harness_slug) else {
        return MapCreds::default();
    };
    let Some(spec) = harness.subscription_spec() else {
        return MapCreds::default();
    };

    let mut by_container_path = std::collections::HashMap::new();
    for file in spec.files() {
        let Some(base) = basename(file.container_path) else {
            continue;
        };
        let path = dir.join(base);
        match std::fs::read(&path) {
            Ok(bytes) => {
                by_container_path.insert(file.container_path.to_string(), bytes);
            }
            // An absent file (the operator did not include this optional key, or
            // the Secret is absent entirely) is skipped; core decides whether a
            // required credential being missing fails the run.
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            // A present-but-unreadable file is also skipped here (core then reports
            // the subscription as unavailable). This is an unexpected state — a
            // mounted-but-unreadable credential usually means a permissions
            // mismatch (e.g. a root-owned Secret volume the non-root driver cannot
            // read without an fsGroup) — so log it rather than fail silently, which
            // is otherwise indistinguishable from the file simply being absent.
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    path = %path.display(),
                    container_path = file.container_path,
                    "subscription credential is present but unreadable; treating it as absent",
                );
            }
        }
    }
    MapCreds::new(by_container_path)
}

/// The final path component of a credential's container path, used as the Secret
/// key. Returns `None` for a path with no file component (which never occurs for a
/// real credential path).
fn basename(container_path: &str) -> Option<&str> {
    container_path.rsplit('/').next().filter(|s| !s.is_empty())
}

#[cfg(test)]
#[path = "creds.test.rs"]
mod tests;
