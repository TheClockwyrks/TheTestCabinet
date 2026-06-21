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

        // The starter workspace is seeded first, so the specs, assets, and
        // reference screenshots below land on top of a baseline project (a
        // `package.json` and whatever else the case ships). Each file's `dest` is
        // relative to the run's root. Resolution already rejected any collision
        // between a workspace file and a spec/asset/reference dest, so these
        // copies never clobber one another.
        for file in request.workspace {
            copy_file(&file.source_path, &repo.join(&file.dest))?;
        }

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

        // Reference media is seeded as visual targets under `reference/`, one file
        // per view (a rendered mockup is a `.png`; a static reference keeps its own
        // extension), alongside a short notice. A rendered reference's source
        // mockup is deliberately not seeded.
        if !request.references.is_empty() {
            let reference_dir = repo.join("reference");
            for rendered in request.references {
                copy_file(
                    &rendered.media_path,
                    &reference_dir.join(rendered.file_name()),
                )?;
            }
            fs::write(reference_dir.join("README.md"), reference_notice(request))
                .map_err(seed_err)?;
        }

        // An asset-generation run draws through the `draw` binary. Seed the canvas
        // config it reads, plus an empty action log and a blank starting preview,
        // so the model can read the empty canvas before its first operation and
        // its calls need no flags. Rendering the blank preview uses the same
        // drawing library the binary and the validator use, so the starting state
        // is exactly what an empty log regenerates to.
        if test_case.test_type == crate::test_case::TestType::AssetGeneration {
            seed_asset_tool(test_case, &repo, request.live_preview)?;
        }

        // An adversarial run's scaffolding is entirely declarative: the starter
        // workspace (the `foray` CLI, the map definitions, and the bundled
        // reference-controller sources), the `world`/`action` contract schemas, and
        // any committed assets are all authored files the manifest names, so they
        // are seeded by the common workspace/spec/asset copying above. Unlike an
        // asset-generation run — which needs a *synthesized* canvas config and a
        // blank starting preview — there is nothing to generate here, so this
        // branch deliberately seeds nothing extra. It exists to make the per-type
        // handling explicit and to be the hook should a future adversarial case
        // need synthesized scaffolding (a pre-built baseline `.wasm`, say).
        if test_case.test_type == crate::test_case::TestType::Adversarial {
            seed_adversarial(test_case, &repo)?;
        }

        let initial_commit = init_repo(&repo)?;
        Ok(SeededRepo {
            path: repo,
            initial_commit,
        })
    }
}

/// Seed an asset-generation run's drawing scaffold into `repo`: the canvas
/// config the `draw` binary reads, an empty action log, and a blank starting
/// preview rendered from that empty log.
fn seed_asset_tool(
    test_case: &crate::TestCaseVersion,
    repo: &Path,
    live_preview: Option<&crate::preview::LivePreviewEndpoint>,
) -> Result<()> {
    let canvas_spec = test_case
        .canvas
        .as_ref()
        .ok_or_else(|| Error::Seeding("asset-generation case has no [canvas]".to_string()))?;
    let tool = test_case
        .tool
        .as_ref()
        .ok_or_else(|| Error::Seeding("asset-generation case has no [tool]".to_string()))?;
    let output = test_case
        .output
        .as_ref()
        .ok_or_else(|| Error::Seeding("asset-generation case has no [output]".to_string()))?;

    let preview = tool.preview.to_string_lossy().replace('\\', "/");
    let actions = output.actions.to_string_lossy().replace('\\', "/");

    let background = test_cabinet_draw::Background::parse(&canvas_spec.background)
        .map_err(|err| Error::Seeding(format!("invalid canvas background: {err}")))?;
    let canvas = test_cabinet_draw::Canvas {
        width: canvas_spec.width,
        height: canvas_spec.height,
        background,
    };

    // The config the binary reads. For a sprite sheet the `actions`/`preview`
    // values are `{frame}` templates and the config lists the declared frames, so
    // `draw-sheet init` and every operation resolve each frame's separate files;
    // for a single sprite they are plain paths.
    let mut config = serde_json::json!({
        "width": canvas_spec.width,
        "height": canvas_spec.height,
        "background": canvas_spec.background,
        "actions": actions,
        "preview": preview,
    });
    if let Some(sheet) = &test_case.sheet {
        config["frames"] = serde_json::json!(sheet.frames);
    }
    // When a viewer is observing the run, seed the live-preview endpoint so the
    // drawing binary streams each re-rendered frame back to the host. Absent for an
    // unobserved run (a plain `tcab run`/`tcab validate`), which seeds no `live`.
    if let Some(live) = live_preview {
        config["live"] = serde_json::json!({
            "endpoint": live.endpoint,
            "token": live.token,
        });
    }
    write_file(
        &repo.join(crate::test_case::ASSET_CONFIG_DEST),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(&config)
                .map_err(|err| { Error::Seeding(format!("serializing canvas config: {err}")) })?
        ),
    )?;

    // Seed each frame's empty action log and blank starting preview, rendered from
    // the empty log through the same drawing library the binary and validator use,
    // so the run starts from a known, empty state. A single sprite is one frame; a
    // sprite sheet is one per declared frame.
    let frame_indices: Vec<u32> = match &test_case.sheet {
        Some(sheet) => sheet.frames.clone(),
        None => vec![0],
    };
    for index in frame_indices {
        let (actions_rel, preview_rel) = match &test_case.sheet {
            Some(_) => (
                crate::test_case::frame_path(&output.actions, index),
                crate::test_case::frame_path(&tool.preview, index),
            ),
            None => (output.actions.clone(), tool.preview.clone()),
        };
        let actions_path = repo.join(&actions_rel);
        if let Some(parent) = actions_path.parent() {
            fs::create_dir_all(parent).map_err(seed_err)?;
        }
        write_file(&actions_path, "[]\n")?;

        let preview_path = repo.join(&preview_rel);
        if let Some(parent) = preview_path.parent() {
            fs::create_dir_all(parent).map_err(seed_err)?;
        }
        test_cabinet_draw::render(&canvas, &[])
            .encode_png(&preview_path)
            .map_err(seed_err)?;
    }
    Ok(())
}

/// Seed an adversarial run's scaffolding into `repo`.
///
/// Every part of an adversarial run's scaffolding — the starter workspace, the
/// `world`/`action` contract schemas (seeded as common specs), the bundled
/// reference controllers, and the map definitions — is an authored file the
/// manifest declares, so it is already copied in by the common
/// workspace/spec/asset seeding. This validates the required tables are present
/// (the orchestrator only routes adversarial runs here, so their absence is an
/// invariant violation worth surfacing as a clear seeding error) and otherwise
/// synthesizes nothing.
fn seed_adversarial(test_case: &crate::TestCaseVersion, _repo: &Path) -> Result<()> {
    if test_case.contract.is_none() {
        return Err(Error::Seeding(
            "adversarial case has no [contract]".to_string(),
        ));
    }
    if test_case
        .build
        .as_ref()
        .and_then(|b| b.module.as_ref())
        .is_none()
    {
        return Err(Error::Seeding(
            "adversarial case has no build.module".to_string(),
        ));
    }
    Ok(())
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
///
/// The current trace context is propagated to the child as `TRACEPARENT` so the
/// seeding subprocesses can be correlated to the run; a no-op when nothing is in
/// scope to propagate.
fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let mut command = Command::new("git");
    command.args(args).current_dir(repo);
    if let Some(traceparent) = test_cabinet_telemetry::propagation::current_traceparent() {
        command.env("TRACEPARENT", traceparent);
    }
    let output = command.output().map_err(seed_err)?;
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
