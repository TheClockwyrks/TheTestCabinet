//! The uploaded reference builds of a stored suite version:
//! `<store>/suites/<slug>/<version>/reference-builds/<engine>/`.
//!
//! A reference implementation is built and verified on the development machine by
//! The Spec Cabinet, which uploads the static build. Ingest stays a copy rather
//! than a build, so the builds live beside the ingested suite record rather than
//! inside the version tree ingest swaps into place: re-ingesting a version keeps
//! the builds uploaded for it, and only the prune that drops the version drops
//! them with it.

use std::io::Read;
use std::path::{Component, Path, PathBuf};

use crate::error::{BackendError, Result};
use crate::store::DefinitionStore;

/// The directory the uploaded suite reference builds live under, inside the store
/// root.
pub const SUITE_BUILDS_DIR: &str = "suites";

/// The directory one suite version's builds live in, one folder per engine.
const REFERENCE_BUILDS_DIR: &str = "reference-builds";

/// The file a build serves at its root, and the one an upload must carry.
const BUILD_INDEX: &str = "index.html";

/// The most bytes an upload may unpack to. The compressed body is capped by the
/// route; this caps what a small archive may expand into on the store's volume.
pub const MAX_UNPACKED_BUILD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

impl DefinitionStore {
    /// The directory one suite version's uploaded builds live under.
    fn suite_builds_version_dir(&self, slug: &str, version: &str) -> PathBuf {
        self.root().join(SUITE_BUILDS_DIR).join(slug).join(version)
    }

    /// The directory the uploaded build for one engine of a suite version is served
    /// from.
    pub fn suite_reference_build_dir(&self, slug: &str, version: &str, engine: &str) -> PathBuf {
        self.suite_builds_version_dir(slug, version)
            .join(REFERENCE_BUILDS_DIR)
            .join(engine)
    }

    /// Unpack a gzipped tar of a static build as the reference build for `engine`
    /// of the suite version `(slug, version)`, replacing any previous upload for
    /// that engine atomically.
    ///
    /// The archive's root is the build's root, so it must carry an `index.html`
    /// there. Only regular files and directories are unpacked: an entry that is a
    /// link, or whose path leaves the build, refuses the whole upload, as does an
    /// archive that expands past [`MAX_UNPACKED_BUILD_BYTES`]. The caller checks
    /// that the version is ingested and declares the engine.
    pub fn store_suite_reference_build(
        &self,
        slug: &str,
        version: &str,
        engine: &str,
        archive: impl Read,
    ) -> Result<()> {
        for segment in [slug, version, engine] {
            require_segment(segment)?;
        }
        let staged = self.staging_root().join(format!(
            "reference-build-{slug}-{version}-{engine}-{}",
            cuid2::create_id()
        ));
        std::fs::create_dir_all(&staged)?;
        let unpacked = unpack_build(&staged, archive, MAX_UNPACKED_BUILD_BYTES).and_then(|()| {
            if staged.join(BUILD_INDEX).is_file() {
                Ok(())
            } else {
                Err(BackendError::BadRequest(format!(
                    "the archive holds no `{BUILD_INDEX}` at its root; archive the contents \
                     of the build output rather than the folder holding them"
                )))
            }
        });
        if let Err(err) = unpacked {
            let _ = std::fs::remove_dir_all(&staged);
            return Err(err);
        }
        let dest = self.suite_reference_build_dir(slug, version, engine);
        let swapped = self.swap_into_place(
            &dest,
            &staged,
            &format!("retired-reference-build-{slug}-{version}-{engine}"),
        );
        if swapped.is_err() {
            let _ = std::fs::remove_dir_all(&staged);
        }
        swapped
    }

    /// The engines a suite version holds an uploaded build for, sorted.
    pub fn list_suite_reference_builds(&self, slug: &str, version: &str) -> Result<Vec<String>> {
        if [slug, version].iter().any(|s| require_segment(s).is_err()) {
            return Ok(Vec::new());
        }
        let dir = self
            .suite_builds_version_dir(slug, version)
            .join(REFERENCE_BUILDS_DIR);
        Ok(crate::store::sorted_dir_names(&dir)?
            .into_iter()
            .filter(|engine| dir.join(engine).join(BUILD_INDEX).is_file())
            .collect())
    }

    /// Drop every build uploaded for a suite version, removing the suite's folder
    /// once its last version's builds are gone.
    pub(crate) fn remove_suite_reference_builds(&self, slug: &str, version: &str) -> Result<()> {
        if [slug, version].iter().any(|s| require_segment(s).is_err()) {
            return Ok(());
        }
        let dir = self.suite_builds_version_dir(slug, version);
        self.retire_dir(&dir, &format!("pruned-reference-builds-{slug}-{version}"))?;
        // `remove_dir` only succeeds on an empty directory, so a suite that still
        // holds other versions' builds is left untouched.
        let _ = std::fs::remove_dir(self.root().join(SUITE_BUILDS_DIR).join(slug));
        Ok(())
    }
}

/// Refuse a path segment that is not a single plain name, so no address component
/// can climb out of the store.
pub(crate) fn require_segment(segment: &str) -> Result<()> {
    let plain = !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment.starts_with('.')
        && !segment.contains(['/', '\\', '\0']);
    if plain {
        Ok(())
    } else {
        Err(BackendError::BadRequest(format!(
            "`{segment}` is not a valid path segment"
        )))
    }
}

/// Unpack a gzipped tar into `dest`, entry by entry.
fn unpack_build(dest: &Path, archive: impl Read, max_bytes: u64) -> Result<()> {
    let mut reader = CappedReader {
        inner: flate2::read::GzDecoder::new(archive),
        remaining: max_bytes,
        exceeded: false,
    };
    let result = unpack_entries(dest, &mut reader);
    if reader.exceeded {
        return Err(BackendError::BadRequest(format!(
            "the archive unpacks to more than {max_bytes} bytes"
        )));
    }
    result
}

fn unpack_entries<R: Read>(dest: &Path, reader: &mut CappedReader<R>) -> Result<()> {
    let unreadable = |err: std::io::Error| {
        BackendError::BadRequest(format!("the upload is not a readable gzipped tar: {err}"))
    };
    let mut archive = tar::Archive::new(reader);
    for entry in archive.entries().map_err(unreadable)? {
        let mut entry = entry.map_err(unreadable)?;
        let path = entry.path().map_err(unreadable)?.into_owned();
        let shown = path.display().to_string();
        let kind = entry.header().entry_type();
        if kind.is_pax_global_extensions()
            || kind.is_pax_local_extensions()
            || kind.is_gnu_longname()
            || kind.is_gnu_longlink()
        {
            continue;
        }
        let relative = relative_entry_path(&path).ok_or_else(|| {
            BackendError::BadRequest(format!("the archive entry `{shown}` leaves the build"))
        })?;
        let target = dest.join(&relative);
        if kind.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if !kind.is_file() {
            return Err(BackendError::BadRequest(format!(
                "the archive entry `{shown}` is not a regular file or directory; a reference \
                 build holds only those"
            )));
        }
        if relative.as_os_str().is_empty() {
            return Err(BackendError::BadRequest(format!(
                "the archive entry `{shown}` names no file"
            )));
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::File::create(&target)?;
        std::io::copy(&mut entry, &mut file).map_err(unreadable)?;
    }
    Ok(())
}

/// An entry's path relative to the build root, or `None` when it is absolute or
/// climbs out with `..`. A leading `./` is dropped.
fn relative_entry_path(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => out.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

/// A reader that fails once more than `remaining` bytes have been read through it,
/// recording that it did so the caller can name the reason.
struct CappedReader<R> {
    inner: R,
    remaining: u64,
    exceeded: bool,
}

impl<R: Read> Read for CappedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let read = self.inner.read(buf)?;
        match self.remaining.checked_sub(read as u64) {
            Some(left) => {
                self.remaining = left;
                Ok(read)
            }
            None => {
                self.exceeded = true;
                Err(std::io::Error::other(
                    "the archive unpacks past the size cap",
                ))
            }
        }
    }
}

#[cfg(test)]
#[path = "suite_store.reference_builds.test.rs"]
pub(crate) mod tests;
