//! **The test suite's on-disk store of prepared programs**, which exists only under `#[cfg(test)]`.
//!
//! # Why tests have one
//!
//! `cargo nextest` runs **one process per test**. A compiled language arm's tests each need a
//! program built by that arm's real toolchain — a JVM running `kotlinc` and TeaVM, or `swiftc` and
//! its linker — and a process that builds one from cold pays the toolchain's whole start-up for a
//! fixture a hundred other processes build too. Under a machine's ordinary load that cold build is
//! what pushes a test past nextest's termination bound, and none of it is what the test is about.
//! This store lets every process after the first take the fixture's result from disk.
//!
//! It is a store for **tests**, and only for the tests that ask it for a program. It is never
//! reachable from an arm, from [`run_program`](super::run_program) or from the isolation gate: a
//! build cache shared across preparations inside an arm is exactly the breach that gate exists to
//! catch, so the gate and the turn path keep compiling for real.
//!
//! # What an entry is keyed on
//!
//! The SHA-256 of everything that shapes the output, and nothing else: the language, the arm's
//! compiler [identity](Identity) (its version and the toolchain it resolved), the content of every
//! embedded input the arm compiles against, the program's source, and each code module's key and
//! source in order. Each field is framed with its length, so no two different sets of inputs encode
//! alike. A content key rather than a test name or a clock: a rebuild that changes no input is a
//! hit, and any change to an input is a miss, never a stale hit.
//!
//! # What an entry holds
//!
//! The component bytes the arm built, or the **model-facing** failure it answered with — a
//! [`PrepareFailure::Program`], which is a property of the source and the toolchain as surely as a
//! component is. A [`Toolchain`](PrepareFailure::Toolchain) failure (a compiler that crashed, timed
//! out or is missing) and a [`Lowering`](PrepareFailure::Lowering) failure (gg's own defect) are
//! returned to the caller and never stored: either may not happen again, and a stored one would
//! fail every later test that asked.
//!
//! # Concurrency
//!
//! One process builds each key. A builder takes an exclusive [`File::lock`] on a lock file of the
//! key's own name; a process that asks for the same key while it builds blocks on that lock, then
//! finds the entry and loads it. Entries are staged under a name unique to the process and call,
//! flushed and [renamed](fs::rename) into place, so a reader sees either no entry or a whole one.
//! An entry carries a digest of its own contents, and one that fails it is rebuilt.
//!
//! Every failure here — an unwritable directory, a lock that cannot be taken, a corrupt entry —
//! falls back to building, so the store can make a test faster but never make one fail.

use std::fs::{self, File};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use sha2::{Digest, Sha256};

use super::CodeModule;
use super::language::{PrepareError, PrepareFailure};

/// How many bytes of entries the directory may hold before the least recently used are removed. A
/// Swift program is ~7 MB and a Kotlin one well under that, and a build's Swift fixtures alone are
/// ~1.4 GB; the ceiling holds every fixture of a build with room for the previous vintage of an arm
/// whose identity an edit just changed.
const MAX_STORED_BYTES: u64 = 4 << 30;

/// How long a staged file is kept before a prune removes it. A staged file outlives its call only
/// when the process writing it died, so anything this old is a crash's leftover.
const STAGED_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);

/// The first bytes of every entry, carrying the format's version: an entry of another version
/// fails to decode and is rebuilt.
const MAGIC: &[u8] = b"gg-prepared-v1\n";

/// Where this build's test processes keep their entries: under the crate's own `OUT_DIR`, so it is
/// per user and per target directory, and `cargo clean` removes it with everything else.
pub(super) fn directory() -> &'static Path {
    Path::new(concat!(env!("OUT_DIR"), "/prepared-cache"))
}

/// What the arm that builds a program is, as far as its output is concerned.
#[derive(Debug, Clone, Copy)]
pub(super) struct Identity<'a> {
    /// The language's name.
    pub(super) language: &'a str,
    /// The arm's compiler identity: its version and the toolchain it resolved, so a test that points
    /// the arm at another toolchain never reads a program the first one built.
    pub(super) compiler: &'a str,
    /// Every embedded input the arm compiles against, by a name and its content: an SDK, a driver,
    /// a guest archive. Content is hashed into the key, so a caller may pass the bytes themselves or
    /// a digest of them it keeps.
    pub(super) inputs: &'a [(&'a str, &'a [u8])],
}

/// How a result came to be in hand — returned so the store's own tests, and the tests that build
/// through it, can assert which path was taken **without timing anything**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Obtained {
    /// Built here by the caller's build function.
    Built,
    /// Read from a stored entry; nothing was built.
    Loaded,
}

/// The result of preparing `source` with `modules` under `identity`, from `directory` when an entry
/// is there and from `build` otherwise — see the [module documentation](self).
pub(super) fn load_or_build(
    directory: &Path,
    identity: &Identity<'_>,
    source: &str,
    modules: &[CodeModule],
    build: impl FnOnce() -> Result<Vec<u8>, PrepareFailure>,
) -> (Result<Vec<u8>, PrepareFailure>, Obtained) {
    let key = key(identity, source, modules);
    let entry = directory.join(format!("{key}.entry"));
    if let Some(stored) = load(&entry) {
        return (stored, Obtained::Loaded);
    }
    // Held until this function returns, so no other process builds this key meanwhile. Without it
    // the result is still right; two processes may only build the same thing twice.
    let lock = fs::create_dir_all(directory)
        .and_then(|()| {
            File::options()
                .create(true)
                .truncate(false)
                .write(true)
                .open(directory.join(format!("{key}.lock")))
        })
        .and_then(|file| file.lock().map(|()| file))
        .ok();
    if lock.is_some()
        && let Some(stored) = load(&entry)
    {
        return (stored, Obtained::Loaded);
    }
    let built = build();
    if lock.is_some()
        && let Some(encoded) = encode(&built)
        && store(&entry, &encoded).is_ok()
    {
        prune(directory, MAX_STORED_BYTES, STAGED_LIFETIME);
    }
    (built, Obtained::Built)
}

/// The name an entry for these inputs is stored under.
fn key(identity: &Identity<'_>, source: &str, modules: &[CodeModule]) -> String {
    let mut hasher = Sha256::new();
    let mut field = |bytes: &[u8]| {
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    };
    field(MAGIC);
    field(identity.language.as_bytes());
    field(identity.compiler.as_bytes());
    field(&(identity.inputs.len() as u64).to_le_bytes());
    for (name, content) in identity.inputs {
        field(name.as_bytes());
        field(&Sha256::digest(content));
    }
    field(source.as_bytes());
    field(&(modules.len() as u64).to_le_bytes());
    for module in modules {
        field(module.name.as_bytes());
        field(module.source.as_bytes());
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The stored result at `entry`, or `None` when there is none or it does not decode. A hit is
/// touched so the prune removes the least recently USED entries, not the oldest.
fn load(entry: &Path) -> Option<Result<Vec<u8>, PrepareFailure>> {
    let stored = decode(&fs::read(entry).ok()?)?;
    let _ = File::options()
        .write(true)
        .open(entry)
        .and_then(|file| file.set_modified(SystemTime::now()));
    Some(stored)
}

/// The tag of each storable result.
const COMPONENT: u8 = 0;
const SYNTAX: u8 = 1;
const COMPILE: u8 = 2;
const UNSUPPORTED: u8 = 3;

/// `result` as an entry's contents — `None` for a result that is never stored. The layout is the
/// [magic](MAGIC), a tag, the payload's length and the payload, then the SHA-256 of all of that.
fn encode(result: &Result<Vec<u8>, PrepareFailure>) -> Option<Vec<u8>> {
    let (tag, payload): (u8, &[u8]) = match result {
        Ok(component) => (COMPONENT, component),
        Err(PrepareFailure::Program(PrepareError::Syntax(text))) => (SYNTAX, text.as_bytes()),
        Err(PrepareFailure::Program(PrepareError::Compile(text))) => (COMPILE, text.as_bytes()),
        Err(PrepareFailure::Program(PrepareError::Unsupported(text))) => {
            (UNSUPPORTED, text.as_bytes())
        }
        Err(PrepareFailure::Toolchain(_) | PrepareFailure::Lowering(_)) => return None,
    };
    let mut encoded = Vec::with_capacity(MAGIC.len() + 9 + payload.len() + 32);
    encoded.extend_from_slice(MAGIC);
    encoded.push(tag);
    encoded.extend_from_slice(&(payload.len() as u64).to_le_bytes());
    encoded.extend_from_slice(payload);
    let digest = Sha256::digest(&encoded);
    encoded.extend_from_slice(&digest);
    Some(encoded)
}

/// The result an entry's contents hold, or `None` for contents [`encode`] did not write whole.
fn decode(encoded: &[u8]) -> Option<Result<Vec<u8>, PrepareFailure>> {
    let (body, digest) = encoded.split_at_checked(encoded.len().checked_sub(32)?)?;
    if Sha256::digest(body).as_slice() != digest {
        return None;
    }
    let rest = body.strip_prefix(MAGIC)?;
    let (&tag, rest) = rest.split_first()?;
    let (length, payload) = rest.split_first_chunk::<8>()?;
    if u64::try_from(payload.len()).ok()? != u64::from_le_bytes(*length) {
        return None;
    }
    let text = || String::from_utf8(payload.to_vec()).ok();
    Some(match tag {
        COMPONENT => Ok(payload.to_vec()),
        SYNTAX => Err(PrepareError::Syntax(text()?).into()),
        COMPILE => Err(PrepareError::Compile(text()?).into()),
        UNSUPPORTED => Err(PrepareError::Unsupported(text()?).into()),
        _ => return None,
    })
}

/// Write `contents` to `entry` atomically: staged under a name unique to this process and call,
/// flushed to disk, then renamed into place, so the name never points at bytes the disk does not
/// hold yet.
fn store(entry: &Path, contents: &[u8]) -> std::io::Result<()> {
    static STAGED: AtomicU64 = AtomicU64::new(0);
    let staged = entry.with_extension(format!(
        "{}-{}.staged",
        std::process::id(),
        STAGED.fetch_add(1, Ordering::Relaxed)
    ));
    let write = || -> std::io::Result<()> {
        let mut file = File::create(&staged)?;
        std::io::Write::write_all(&mut file, contents)?;
        file.sync_all()
    };
    write()
        .and_then(|()| fs::rename(&staged, entry))
        .inspect_err(|_| {
            let _ = fs::remove_file(&staged);
        })
}

/// Remove the least recently used entries, with their lock files, until the directory holds at most
/// `max_bytes` of them, and every staged file older than `staged_lifetime`.
///
/// Runs after a store, which is once per distinct program per build. Removing a lock file another
/// process is waiting on costs at most one duplicate build of that key: the waiter then holds a lock
/// nobody else will take, builds, and renames the same result into place.
fn prune(directory: &Path, max_bytes: u64, staged_lifetime: Duration) {
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
            Some("entry") => stored.push((modified, metadata.len(), path)),
            Some("staged")
                if now
                    .duration_since(modified)
                    .is_ok_and(|age| age > staged_lifetime) =>
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
            Err(_) => continue,
        }
        let _ = fs::remove_file(path.with_extension("lock"));
    }
}

#[cfg(test)]
#[path = "prepared_cache.test.rs"]
mod tests;
