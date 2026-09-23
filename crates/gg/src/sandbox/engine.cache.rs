//! **The test suite's on-disk cache of compiled components**, which exists only under `#[cfg(test)]`.
//!
//! # Why tests have one and production does not
//!
//! Production runs one gg process per run in an ephemeral container, so a compiled component
//! written to disk would be thrown away with the container; the process-wide
//! [`COMPONENTS`](super::COMPONENTS) is the whole of what a run needs (see [`engine`](super::engine)).
//! `cargo nextest` inverts that: it runs **one process per test**, thousands of them, and every one
//! that touches an embedded guest Cranelift-compiles byte-identical input from scratch. The embedded
//! guests are tens of megabytes, so that repeated compile — not anything a test is about — was
//! the largest share of the suite's CPU: tens of CPU-seconds per test process against well under a
//! second to map a compiled copy back in.
//!
//! # What an entry is keyed on
//!
//! The SHA-256 of the component bytes, plus wasmtime's own
//! [`precompile_compatibility_hash`](wasmtime::Engine::precompile_compatibility_hash) of the shared
//! engine, which covers the wasmtime version, the target, the compiler flags and every
//! [`Config`](wasmtime::Config) setting that changes the code. A different guest, a different
//! engine configuration, or a wasmtime upgrade is therefore a different file, never a stale hit, and
//! [`Component::deserialize_file`] repeats that compatibility check itself on the way in, so an
//! entry that somehow disagrees is refused rather than run.
//!
//! # Only bytes seen twice are stored
//!
//! An entry is written the **second** time its bytes are compiled; the first time leaves a
//! zero-byte marker. Every embedded guest is seen by thousands of processes, so this costs them one
//! extra compile per build. What it buys is that the cache never fills with artifacts that can
//! never be hit again: the Swift arm's compiler writes a per-process clang module-cache hash into
//! each program's debug information, so two compiles of one Swift program are different bytes, and
//! at ~7 MB a program they would otherwise be the bulk of the directory. The other compiled arms
//! (Rust, C++, Java, Kotlin) produce byte-identical artifacts for identical programs, so a program
//! a later test or a later run compiles again is served from here like a guest is.
//!
//! # Concurrency
//!
//! Many test processes read and write the directory at once. An entry is staged under a name unique
//! to this process and call and [renamed](std::fs::rename) into place, so a reader sees either no
//! file or a whole one; two writers of the same key write the same bytes and the last rename wins.
//! Nothing is ever written into an existing entry, which is what mapping one with
//! [`Component::deserialize_file`] requires: replacing or deleting a file leaves every mapping of
//! the old one intact.
//!
//! Every failure here — an unwritable directory, a missing entry, a corrupt one — falls back to
//! compiling, so the cache can make a test faster but never make one fail.

use std::fs::{self, File};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};
use wasmtime::Engine;
use wasmtime::component::Component;

use super::SandboxError;

/// How many bytes of stored entries the directory may hold before the least recently used are
/// removed. Every embedded guest together is under 200 MB per build; the rest of the ceiling is
/// room for the compiled arms' programs and for a few builds' worth of guests.
const MAX_STORED_BYTES: u64 = 4 << 30;

/// How long a first-sighting marker is kept before a prune removes it. A marker whose bytes are
/// never compiled again — every Swift program's — would otherwise accumulate forever.
const MARKER_LIFETIME: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Where this build's test processes keep their entries: under the crate's own `OUT_DIR`, so it is
/// per user and per target directory, and `cargo clean` removes it with everything else.
pub(super) fn directory() -> &'static Path {
    Path::new(concat!(env!("OUT_DIR"), "/component-cache"))
}

/// How a component came to be in memory — returned so the cache's own tests can assert which path
/// was taken **without timing anything**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Materialised {
    /// Compiled here, and not stored: the first time these bytes were seen.
    Compiled,
    /// Compiled here, and stored for the next process that asks.
    CompiledAndStored,
    /// Mapped in from a stored entry; nothing was compiled.
    Loaded,
}

/// `bytes` as a component of `engine`, from `directory` when an entry is there and compiled
/// otherwise — see the [module documentation](self) for when an entry is written.
pub(super) fn load_or_compile(
    engine: &Engine,
    bytes: &[u8],
    directory: &Path,
    compile: impl FnOnce(&[u8]) -> Result<Component, SandboxError>,
) -> Result<(Component, Materialised), SandboxError> {
    let key = key(engine, bytes);
    let entry = directory.join(format!("{key}.cwasm"));
    if entry.is_file() {
        // SAFETY: `deserialize_file` requires a file produced by `Component::serialize` for a
        // compatible engine, left unmodified while it is mapped. Only `store` below writes into this
        // directory — the output of `Component::serialize`, staged and renamed so no reader sees a
        // partial file — and nothing ever writes into an existing entry. The key carries the engine's
        // compatibility hash, and wasmtime re-checks the engine and its own version in the file's
        // header and refuses a mismatch, which lands in the fallback below.
        if let Ok(component) = unsafe { Component::deserialize_file(engine, &entry) } {
            // Touched so the prune below removes the least recently USED entries, not the oldest.
            let _ = File::options()
                .write(true)
                .open(&entry)
                .and_then(|file| file.set_modified(SystemTime::now()));
            return Ok((component, Materialised::Loaded));
        }
    }
    let component = compile(bytes)?;
    let marker = directory.join(format!("{key}.seen"));
    if !marker.is_file() && !entry.is_file() {
        let _ = fs::create_dir_all(directory).and_then(|()| File::create(&marker));
        return Ok((component, Materialised::Compiled));
    }
    match component
        .serialize()
        .ok()
        .is_some_and(|serialized| store(&entry, &serialized).is_ok())
    {
        true => {
            let _ = fs::remove_file(&marker);
            prune(directory, MAX_STORED_BYTES, MARKER_LIFETIME);
            Ok((component, Materialised::CompiledAndStored))
        }
        false => Ok((component, Materialised::Compiled)),
    }
}

/// The name an entry for `bytes` is stored under.
fn key(engine: &Engine, bytes: &[u8]) -> String {
    let mut compatibility = DefaultHasher::new();
    engine
        .precompile_compatibility_hash()
        .hash(&mut compatibility);
    let digest = Sha256::digest(bytes);
    let content: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{content}-{:016x}", compatibility.finish())
}

/// Write `contents` to `entry` atomically: staged under a name unique to this process and call,
/// then renamed into place.
fn store(entry: &Path, contents: &[u8]) -> std::io::Result<()> {
    static STAGED: AtomicU64 = AtomicU64::new(0);
    let staged = entry.with_extension(format!(
        "{}-{}.staged",
        std::process::id(),
        STAGED.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&staged, contents)
        .and_then(|()| fs::rename(&staged, entry))
        .inspect_err(|_| {
            let _ = fs::remove_file(&staged);
        })
}

/// Remove the least recently used stored entries until the directory holds at most `max_bytes` of
/// them, and every first-sighting marker older than `marker_lifetime`.
///
/// Runs after a store, which is rare — a few times per build for the guests, once per distinct
/// program for the compiled arms — so a directory listing per call is nothing. Entries another
/// process is mapping are safe to remove: the mapping outlives the name.
pub(super) fn prune(directory: &Path, max_bytes: u64, marker_lifetime: Duration) {
    let Ok(listing) = fs::read_dir(directory) else {
        return;
    };
    let now = SystemTime::now();
    let mut stored: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
    for entry in listing.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified = metadata.modified().unwrap_or(now);
        match path.extension().and_then(|extension| extension.to_str()) {
            Some("cwasm") => stored.push((modified, metadata.len(), path)),
            Some("seen")
                if now
                    .duration_since(modified)
                    .is_ok_and(|age| age > marker_lifetime) =>
            {
                let _ = fs::remove_file(&path);
            }
            _ => {}
        }
    }
    let mut total: u64 = stored.iter().map(|(_, len, _)| len).sum();
    stored.sort();
    for (_, len, path) in stored {
        if total <= max_bytes {
            break;
        }
        match fs::remove_file(&path) {
            Ok(()) => total -= len,
            Err(error) if error.kind() == ErrorKind::NotFound => total -= len,
            Err(_) => {}
        }
    }
}

#[cfg(test)]
#[path = "engine.cache.test.rs"]
mod tests;
