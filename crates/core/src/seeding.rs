//! Concrete [`RepoSeeder`]: seed a fresh git repository for a run.
//!
//! See `docs/execution.md#seeding`. A run is seeded into a brand-new git
//! repository containing the specification, assets, and the rendered reference
//! screenshots (visual targets) — but never the reference *source* mockups —
//! with a single initial commit, no history, and no remote.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use time::OffsetDateTime;

use crate::error::{Error, Result};
use crate::execution::{RepoSeeder, SeedRequest, SeededRepo};

/// Seeds runs into fresh git repositories under a base directory.
///
/// Each call creates a unique sub-directory named `{slug}-{version}-{timestamp}`
/// so the newest run sorts last in a directory listing and can be spotted at a
/// glance. Should two runs ever land in the same second, a `-{n}` tiebreaker is
/// appended so concurrent runs never collide.
#[derive(Debug, Clone)]
pub struct FsRepoSeeder {
    /// The directory new run repositories are created under.
    base_dir: PathBuf,
}

impl FsRepoSeeder {
    /// Create a seeder that places run repositories under `base_dir`.
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    /// Create a fresh, uniquely named run directory under `base_dir`.
    ///
    /// The directory is named `{slug}-{version}-{timestamp}` so the most recent
    /// run sorts last and can be found just by looking at the bottom of a
    /// listing. The stamp has one-second resolution, so in the rare case two
    /// runs land in the same second a `-{n}` tiebreaker is appended (`-1`, `-2`,
    /// …). Reservation uses `create_dir` rather than a check-then-create, so the
    /// name is claimed atomically and two racing runs can never pick the same
    /// directory.
    fn create_run_dir(&self, slug: &str, version: &str) -> Result<PathBuf> {
        fs::create_dir_all(&self.base_dir).map_err(seed_err)?;
        let stem = format!("{slug}-{version}-{}", run_timestamp());
        reserve_unique_dir(&self.base_dir, &stem)
    }
}

/// Atomically create a fresh directory under `base_dir` named `stem`, falling
/// back to `stem-1`, `stem-2`, … if earlier candidates already exist.
///
/// Reservation uses `create_dir` so the name is claimed in a single syscall:
/// the only way two concurrent callers can pick the same name is if one of them
/// fails with `AlreadyExists`, in which case it simply moves on to the next
/// tiebreaker. The returned directory is therefore guaranteed to be freshly
/// created and owned by this caller.
fn reserve_unique_dir(base_dir: &Path, stem: &str) -> Result<PathBuf> {
    let mut tiebreaker: u32 = 0;
    loop {
        let name = if tiebreaker == 0 {
            stem.to_string()
        } else {
            format!("{stem}-{tiebreaker}")
        };
        let candidate = base_dir.join(name);
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                tiebreaker += 1;
            }
            Err(err) => return Err(seed_err(err)),
        }
    }
}

impl RepoSeeder for FsRepoSeeder {
    fn seed(&self, request: &SeedRequest<'_>) -> Result<SeededRepo> {
        let test_case = request.test_case;
        let repo = self.create_run_dir(&test_case.slug, &test_case.version)?;

        // Each spec is seeded to its destination path within the fresh
        // repository. Destinations are validated during resolution to stay inside
        // the workspace, so joining them onto the repo root is safe. A spec whose
        // source is a Handlebars template is rendered with the selected variant
        // and version before it lands; any other spec is copied verbatim. Assets
        // keep their path relative to the version folder so any references in a
        // spec (for example `assets/...`) still resolve.
        for spec in request.specs {
            let dest = repo.join(&spec.dest);
            if is_handlebars(&spec.source_path) {
                let rendered =
                    crate::prompt::render_spec(test_case, request.variant, &spec.source_path)?;
                write_file(&dest, &rendered)?;
            } else {
                copy_file(&spec.source_path, &dest)?;
            }
        }

        for asset in &test_case.asset_paths {
            let relative = asset.strip_prefix(&test_case.root).map_err(|_| {
                Error::Seeding(format!(
                    "asset `{}` is outside the version folder",
                    asset.display()
                ))
            })?;
            copy_into(asset, &repo.join(relative))?;
        }

        // Reference screenshots are seeded as visual targets under `reference/`,
        // one PNG per view, alongside a short notice. The reference source
        // mockups they were rendered from are deliberately not seeded.
        if !request.references.is_empty() {
            let reference_dir = repo.join("reference");
            for rendered in request.references {
                copy_file(
                    &rendered.image_path,
                    &reference_dir.join(format!("{}.png", rendered.view)),
                )?;
            }
            fs::write(reference_dir.join("README.md"), reference_notice(request))
                .map_err(seed_err)?;
        }

        let initial_commit = init_repo(&repo)?;
        Ok(SeededRepo {
            path: repo,
            initial_commit,
        })
    }
}

/// Initialize a fresh git repository with a single commit and no remote, and
/// return the initial commit hash.
fn init_repo(repo: &Path) -> Result<String> {
    git(repo, &["init", "--quiet", "--initial-branch", "main"])?;
    // Use repository-local identity so seeding does not depend on the host's
    // global git configuration.
    git(repo, &["config", "user.name", "The Test Cabinet"])?;
    git(repo, &["config", "user.email", "runs@test-cabinet.invalid"])?;
    git(repo, &["add", "--all"])?;
    git(repo, &["commit", "--quiet", "--message", "Seed test case"])?;
    let output = git(repo, &["rev-parse", "HEAD"])?;
    Ok(output.trim().to_string())
}

/// Run a git command in `repo`, returning its stdout, or a seeding error.
fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(seed_err)?;
    if !output.status.success() {
        return Err(Error::Seeding(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Whether a spec source is a Handlebars template, identified by a `.hbs`
/// extension (case-insensitive). Such a spec is rendered before seeding; every
/// other spec is copied verbatim.
fn is_handlebars(source: &Path) -> bool {
    source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("hbs"))
}

/// Copy a single file, creating parent directories as needed.
fn copy_file(from: &Path, to: &Path) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(seed_err)?;
    }
    fs::copy(from, to).map_err(seed_err)?;
    Ok(())
}

/// Write `contents` to a file, creating parent directories as needed. Used to
/// land a rendered `.hbs` spec at its destination.
fn write_file(to: &Path, contents: &str) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(seed_err)?;
    }
    fs::write(to, contents).map_err(seed_err)?;
    Ok(())
}

/// Copy a file or directory (recursively) to `to`.
fn copy_into(from: &Path, to: &Path) -> Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(seed_err)?;
        for entry in fs::read_dir(from).map_err(seed_err)? {
            let entry = entry.map_err(seed_err)?;
            copy_into(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        copy_file(from, to)
    }
}

/// The README seeded alongside the reference screenshots.
///
/// These images are visual targets: the implementation's matching screens should
/// look like them. The reference source is intentionally absent so the UI is
/// built from the specification rather than copied.
fn reference_notice(request: &SeedRequest<'_>) -> String {
    let mut body = String::from(
        "# Reference images\n\n\
         These screenshots show what the corresponding screens of the game should \
         look like. Use them as visual targets for your implementation — match \
         their layout, palette, and type. They are images only; build the UI from \
         the specification.\n\n",
    );
    for rendered in request.references {
        body.push_str(&format!(
            "- `{}.png` — the `{}` view.\n",
            rendered.view, rendered.view
        ));
    }
    body
}

/// A sortable UTC run timestamp, `YYYYMMDD-HHMMSS`.
///
/// This is the date-time portion of a run directory's name. Fixed-width, UTC,
/// and lexicographically ordered so a plain directory listing puts the newest
/// run last; the separators keep it readable without introducing characters
/// (like the `:` of RFC 3339) that are awkward in path names.
fn run_timestamp() -> String {
    let now = OffsetDateTime::now_utc();
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    )
}

/// Wrap an I/O error as a seeding error.
fn seed_err(err: std::io::Error) -> Error {
    Error::Seeding(err.to_string())
}

#[cfg(test)]
#[path = "seeding.test.rs"]
mod tests;
