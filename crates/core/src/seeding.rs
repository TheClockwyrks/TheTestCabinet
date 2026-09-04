//! Concrete [`RepoSeeder`]: seed a fresh git repository for a run.
//!
//! See `docs/execution.md#seeding`. A run is seeded into a brand-new git
//! repository containing the specification, assets, and the rendered reference
//! screenshots (visual targets) — but never the reference *source* mockups —
//! with a single initial commit, no history, and no remote.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::de::{Error as DeError, MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use time::OffsetDateTime;

use crate::engine::ResolvedEngine;
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
    /// The host package store a `packages`-declaring case's runtime libraries are
    /// vendored out of (see [`crate::test_case::TCAB_PACKAGES_DIR`]). Baked into
    /// the images that seed runs; overridable via `TCAB_PACKAGE_STORE` for a local
    /// checkout that has staged the packages elsewhere.
    package_store: PathBuf,
}

impl FsRepoSeeder {
    /// Create a seeder that places run repositories under `base_dir`, vendoring
    /// runtime packages from the default host store (`package_store_dir`).
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
            package_store: package_store_dir(),
        }
    }

    /// Create a seeder that vendors runtime packages from an explicit store path,
    /// rather than the default `package_store_dir`. For tests and callers that
    /// stage the packages somewhere other than the baked image path.
    pub fn with_package_store(
        base_dir: impl Into<PathBuf>,
        package_store: impl Into<PathBuf>,
    ) -> Self {
        Self {
            base_dir: base_dir.into(),
            package_store: package_store.into(),
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

    /// Vendor the case's declared runtime packages — and their transitive
    /// `@test-cabinet` closure — out of the host package store into
    /// [`TCAB_VENDOR_DIR`](crate::test_case::TCAB_VENDOR_DIR) inside `repo`.
    ///
    /// The case's own workspace `package.json` already declares each one as the
    /// matching in-repo relative `file:` dependency (resolution validates that it
    /// does), so this only fills in the copies the declaration points at: unlike
    /// [`Self::vendor_engine`], nothing here rewrites the shipped file.
    fn vendor_packages(&self, repo: &Path, packages: &[String]) -> Result<()> {
        self.vendor_closure(&repo.join(crate::test_case::TCAB_VENDOR_DIR), packages)
    }

    /// Vendor the run's selected [engine](crate::engine) into `repo`, returning
    /// the version that landed.
    ///
    /// Three things happen here, and only here:
    ///
    /// 1. the engine's package and its `@test-cabinet` closure are copied into
    ///    [`TCAB_ENGINE_DIR`](crate::test_case::TCAB_ENGINE_DIR) — a *separate*
    ///    tree from the case's own `.tcab/packages`, so the produced repository
    ///    (and its diff) still says which vendored code is the case's and which is
    ///    the run's;
    /// 2. the engine's own documentation is copied to
    ///    [`ENGINE_DOCS_DIR`](crate::execution::ENGINE_DOCS_DIR), because an engine
    ///    documents itself from its package and a case's specs never restate it;
    /// 3. the seeded workspace `package.json` gains a relative `file:` dependency
    ///    on the vendored copy.
    ///
    /// Step 3 is the **one** place the harness edits a build's `package.json`, and
    /// it is what an engine being a run dimension forces: the case is frozen and
    /// does not know which engine this run picked, so it cannot declare the
    /// dependency itself. The `packages` key is the mirror image — declared by the
    /// case, already present in the `package.json` it ships, and deliberately never
    /// rewritten (see [`Self::vendor_packages`]).
    ///
    /// An engine with no runtime vendors nothing and reports no version.
    /// [`seed`](RepoSeeder::seed) already gates on
    /// [`ResolvedEngine::provides_runtime`], so that arm is a second statement of
    /// the same rule rather than a live path — but it is what makes calling this
    /// with any resolved engine safe.
    fn vendor_engine(&self, repo: &Path, engine: &ResolvedEngine) -> Result<Option<String>> {
        let Some(package) = engine.package() else {
            return Ok(None);
        };

        // The whole `@test-cabinet` closure, exactly as a case's own packages are
        // vendored: the staged engine package references its siblings by relative
        // `file:` paths, which only resolve if the siblings land beside it.
        let roots = [package.to_string()];
        self.vendor_closure(&repo.join(crate::test_case::TCAB_ENGINE_DIR), &roots)?;

        let staged = self.package_store.join(package);
        // Read the version from the *staged* package rather than the copy just
        // written: they are the same bytes, and naming the store in a failure
        // points at the thing an operator has to fix.
        let version = staged_package_version(&staged, package)?;

        if let Some(docs) = engine.docs() {
            let src = staged.join(docs);
            if !src.is_dir() {
                // The in-container path the prompt shows the model, not the host
                // path: this failure is about what the run would tell the model to
                // read, so it names it in the model's terms.
                let in_container = format!(
                    "{}/{}",
                    crate::execution::WORKSPACE_DIR,
                    crate::execution::ENGINE_DOCS_DIR
                );
                return Err(Error::Seeding(format!(
                    "engine `{}` declares a docs directory `{docs}`, but it is missing \
                     from the staged package at `{}` — the rendered prompt points the \
                     build at `{in_container}`, so seeding without it would send the \
                     model to read documentation that is not there; rebuild the package \
                     (`npm run build:packages`) and restage it \
                     (`node scripts/stage-tcab-packages.mjs`)",
                    engine.slug(),
                    src.display(),
                )));
            }
            copy_into(&src, &repo.join(crate::execution::ENGINE_DOCS_DIR))?;
        }

        add_engine_dependency(repo, package)?;
        Ok(Some(version))
    }

    /// Copy `roots` and their transitive `@test-cabinet` dependency closure out of
    /// the host package store into `dest_root`, one directory per package name.
    ///
    /// Shared by the two things that vendor out of that store — a case's declared
    /// `packages` and the run's engine — because the walk is the same walk and
    /// only the destination differs. The staged packages reference their
    /// `@test-cabinet` siblings by a relative `file:` path (for example
    /// particle-runtime → `file:../run-record`), so copying the whole closure into
    /// one directory layout preserves those links; the dependent's `package.json`
    /// then resolves the top-level package by the in-repo relative path it was
    /// written to. Nothing outside the repo is referenced, so the dependency
    /// resolves wherever the tree lives.
    fn vendor_closure(&self, dest_root: &Path, roots: &[String]) -> Result<()> {
        let mut seen = std::collections::HashSet::new();
        let mut queue: Vec<String> = roots.to_vec();
        while let Some(name) = queue.pop() {
            if !seen.insert(name.clone()) {
                continue;
            }
            let src = self.package_store.join(&name);
            if !src.is_dir() {
                return Err(Error::Seeding(format!(
                    "runtime package `{name}` not found in the package store at `{}` — \
                     the driver image bakes it under `{}`; for a local checkout, stage \
                     the packages there (`node scripts/stage-tcab-packages.mjs`) or point \
                     `TCAB_PACKAGE_STORE` at a staged copy",
                    self.package_store.display(),
                    crate::test_case::TCAB_PACKAGES_DIR,
                )));
            }
            copy_into(&src, &dest_root.join(&name))?;
            // Follow the package's own `@test-cabinet` dependencies so the whole
            // closure lands and every relative `file:` link inside it resolves.
            for dep in tcab_dependencies(&src)? {
                queue.push(dep);
            }
        }
        Ok(())
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

        // A case that declares `packages` ships a workspace `package.json` that
        // already depends on each one via an in-repo relative `file:` spec
        // (validated at resolution — see `TestCaseCatalog::resolve`). Vendor the
        // requested libraries out of the host package store into the run repo at
        // that path, so the tree is self-contained: the model's init `npm install`
        // resolves the dependency locally and writes a lockfile that resolves the
        // same wherever the produced tree later lives (validation host, a clone of
        // the published repo). The `package.json` itself is never modified.
        if !test_case.packages.is_empty() {
            self.vendor_packages(&repo, &test_case.packages)?;
        }

        // The run's selected engine is vendored next — after the workspace and the
        // case's own packages, before everything else — because it is the one step
        // that *edits* a seeded file: the `file:` dependency it injects has to go
        // into the final `package.json` the case shipped, not a copy something
        // later overwrites. A run with no engine, or with one that supplies no
        // runtime, seeds nothing here and records no version, leaving the seeded
        // tree exactly as the case shipped it.
        let engine_version = match request.engine {
            Some(engine) if engine.provides_runtime() => self.vendor_engine(&repo, engine)?,
            _ => None,
        };

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
                let rendered = crate::prompt::render_spec(
                    test_case,
                    request.variant,
                    &spec.source_path,
                    request.engine,
                )?;
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

        // An asset-generation run draws/sculpts through a fixed tool binary. Seed
        // the tool config it reads, plus an empty action log and a blank starting
        // preview per target, so the model can read the empty surface before its
        // first operation and its calls need no flags. Rendering the blank preview
        // uses the same library the binary and the validator use, so the starting
        // state is exactly what an empty log regenerates to. The two voxel kinds
        // sculpt through the `voxel`/`voxel-anim` binary and use their own config
        // and (for animation) a pre-seeded `rig.json`.
        if test_case.test_type == crate::test_case::TestType::AssetGeneration {
            let kind = test_case.asset_kind;
            if kind.is_voxel() {
                // The voxel/mesh/skinned kinds sculpt through their `.glb`-emitting
                // binary (skinned single-file; see [`seed_voxel_tool`]). The volume
                // is resolved for the selected variant, so a half/double run seeds
                // its own dimensions.
                seed_voxel_tool(test_case, request.variant, &repo, request.live_preview)?;
            } else if kind.is_blender() {
                // The Blender family (character/prop/mechanism) authors through a
                // `build.py` script run by `tcab-blend`, not an op-log tool. Seed only the
                // config it reads (bounds + output paths +, for the animated members, the
                // required animation names); the `build.py` starter and the brief are
                // seeded as the case's own spec files, and there is no blank preview to
                // render (the model builds from an empty scene).
                seed_blender_tool(test_case, &repo, request.live_preview)?;
            } else if kind.is_paint() {
                seed_paint_tool(test_case, &repo, request.live_preview)?;
            } else if kind.is_particle() {
                seed_particle_tool(test_case, &repo, request.live_preview)?;
            } else if kind.is_audio() {
                seed_audio_tool(test_case, &repo, request.live_preview)?;
            } else {
                seed_asset_tool(test_case, &repo, request.live_preview)?;
            }
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

        // A game jam that has earlier entries (prior runs of the same jam by the same
        // model, under any harness) seeds their gameplay READMEs as reference material,
        // so the prompt's distinctness section can point the model at them. This is
        // context, not part of the submission, so `init_repo` git-ignores the folder
        // rather than committing it.
        if !request.prior_game_jam_entries.is_empty() {
            seed_prior_game_jam_entries(&repo, request.prior_game_jam_entries)?;
        }

        let initial_commit = init_repo(&repo)?;
        Ok(SeededRepo {
            path: repo,
            initial_commit,
            engine_version,
        })
    }
}

/// Seed an asset-generation **reference** workspace into `repo` — the same
/// drawing scaffold a run gets, minus the live-preview endpoint (nothing is
/// observing a reference build).
///
/// Exposed so [`crate::asset_reference`] can build a reference implementation in a
/// workspace seeded by the real path rather than one each reference script stands
/// up for itself. That is what keeps a script from restating — and drifting from —
/// its case's `[canvas]` and declared frames.
pub fn seed_asset_workspace(test_case: &crate::TestCaseVersion, repo: &Path) -> Result<()> {
    seed_asset_tool(test_case, repo, None)
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
        "layers": crate::test_case::ASSET_LAYERS_DEST,
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

    // Seed an empty layer document. Layers are sheet-wide rather than per-frame, so
    // there is exactly one of these however many frames the case declares.
    write_file(
        &repo.join(crate::test_case::ASSET_LAYERS_DEST),
        "{\n  \"layers\": []\n}\n",
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

/// Seed a Blender run's authoring scaffold into `repo`: the `blender.config.json` the
/// `tcab-blend` runner and the model's `build.py` read. It carries the asset's bounding
/// box (the resolved variant's `[voxel]` extents), the world axes, the paths the run
/// emits its glTF and preview to, the authored-script path, and — for the animated
/// members (`blender-character`/`blender-mechanism`) — the **required animation names**
/// the model must author (empty for a static `blender-prop`). Unlike the op-log kinds
/// there is no empty action log or blank preview to seed — the model builds the asset
/// from an empty Blender scene through its `build.py`, which is seeded as the case's own
/// spec file.
fn seed_blender_tool(
    test_case: &crate::TestCaseVersion,
    repo: &Path,
    live_preview: Option<&crate::preview::LivePreviewEndpoint>,
) -> Result<()> {
    let bounds = test_case
        .voxel
        .as_ref()
        .ok_or_else(|| Error::Seeding("Blender case has no [voxel] bounds".to_string()))?;
    let tool = test_case
        .tool
        .as_ref()
        .ok_or_else(|| Error::Seeding("Blender case has no [tool]".to_string()))?;
    let output = test_case
        .output
        .as_ref()
        .ok_or_else(|| Error::Seeding("Blender case has no [output]".to_string()))?;
    // The `[model]` table is present only for the animated members; a static prop has
    // none (and seeds an empty `animations` list).
    let model = test_case.model.as_ref();

    let preview = tool.preview.to_string_lossy().replace('\\', "/");
    let build_script = output.actions.to_string_lossy().replace('\\', "/");

    // The required animations, by identity — the contract an animated `build.py` must
    // satisfy. Empty for a static prop.
    let animations: Vec<serde_json::Value> = model
        .map(|model| {
            model
                .animations
                .iter()
                .map(|animation| {
                    serde_json::json!({
                        "name": animation.name,
                        "loop": animation.looping,
                        "auto_play": animation.auto_play,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // The required **caller joints** — the runtime-drivable DOFs a game aims the asset
    // with (`turret_yaw`). The model builds a node for each and tags it into the emitted
    // glTF's `extras`. Rotation limits are radians here (the emitted/runtime unit). Empty
    // when the case fixes no procedural interface.
    let joints: Vec<serde_json::Value> = model
        .map(|model| {
            model
                .joints
                .iter()
                .filter(|joint| joint.drive == crate::test_case::DriveKindSpec::Caller)
                .map(|joint| {
                    serde_json::json!({
                        "name": joint.name,
                        "kind": joint.kind,
                        "axis": joint.axis,
                        "min": joint.min,
                        "max": joint.max,
                        "rest": joint.rest,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // The path the runner writes the emitted glTF to — `character.glb` for a character,
    // `model.glb` for a prop/mechanism.
    let mesh = test_case
        .asset_kind
        .blender_mesh_dest()
        .ok_or_else(|| Error::Seeding("Blender case has no mesh destination".to_string()))?;

    // The config the `tcab-blend` runner and the model's `build.py` read. The axes are
    // Blender's own authoring space — +Z up, the asset facing -Y (Blender's front view) —
    // because `build.py` runs inside Blender; the bundled export then converts to the
    // family's +Y-up / +Z-forward glTF (`export_yup=True`). The asset must fit the
    // bounding box.
    let mut config = serde_json::json!({
        "bounds": {
            "width": bounds.width,
            "height": bounds.height,
            "depth": bounds.depth,
        },
        "up_axis": "z",
        "forward_axis": "-y",
        "background": bounds.background,
        "mesh": mesh,
        "preview": preview,
        "build_script": build_script,
        "animations": animations,
        "joints": joints,
    });
    // When a viewer is observing the run, seed the live-preview endpoint so the runner
    // streams the exported glTF back to the host as the model iterates.
    if let Some(live) = live_preview {
        config["live"] = serde_json::json!({
            "endpoint": live.endpoint,
            "token": live.token,
        });
    }
    write_file(
        &repo.join(crate::test_case::BLENDER_CONFIG_DEST),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(&config)
                .map_err(|err| Error::Seeding(format!("serializing blender config: {err}")))?
        ),
    )?;
    Ok(())
}

/// Seed a voxel asset-generation run's sculpting scaffold into `repo`: the volume
/// config the `voxel`/`voxel-anim` binary reads, an empty action log and blank
/// isometric preview per target, and — for an animated model — the `rig.json`
/// pre-populated from the manifest's required rig so the game-facing contract
/// exists from the first operation.
fn seed_voxel_tool(
    test_case: &crate::TestCaseVersion,
    variant: &crate::test_case::Variant,
    repo: &Path,
    live_preview: Option<&crate::preview::LivePreviewEndpoint>,
) -> Result<()> {
    // The effective volume for this run: the variant's `[voxel]` override when it
    // declares one (the half/base/double size axis), else the case's common
    // `[voxel]`. Every consumer resolves it through `voxel_for` so the config the
    // binary reads, the brief the model reads, and the validator all agree.
    let voxel_spec = test_case
        .voxel_for(variant)
        .ok_or_else(|| Error::Seeding("voxel case has no [voxel]".to_string()))?;
    let tool = test_case
        .tool
        .as_ref()
        .ok_or_else(|| Error::Seeding("voxel case has no [tool]".to_string()))?;
    let output = test_case
        .output
        .as_ref()
        .ok_or_else(|| Error::Seeding("voxel case has no [output]".to_string()))?;

    let preview = tool.preview.to_string_lossy().replace('\\', "/");
    let actions = output.actions.to_string_lossy().replace('\\', "/");

    let background = test_cabinet_model_core::PreviewBackground::parse(&voxel_spec.background)
        .map_err(|err| Error::Seeding(format!("invalid voxel background: {err}")))?;

    // The config the binary reads. For an animated model the `actions`/`preview`
    // values are `{part}` templates and the config carries the `rig.json` path, so
    // every operation resolves each part's separate files; for a static model they
    // are plain paths. The parts themselves are NOT listed here — an animated case
    // fixes no parts, so the model invents them at run time with `define-part` and the
    // binary reads the growing part set straight from `rig.json`.
    let mut config = serde_json::json!({
        "width": voxel_spec.width,
        "height": voxel_spec.height,
        "depth": voxel_spec.depth,
        "background": voxel_spec.background,
        "actions": actions,
        "preview": preview,
    });
    if test_case.model.is_some() {
        config["rig"] = serde_json::json!(crate::test_case::VOXEL_RIG_DEST);
    }
    // Every voxel-family kind — the two cube kinds and the six surface-meshed kinds —
    // emits its client-facing geometry as a `PartMesh`-shaped `.glb`: a single
    // file for a static model, a `{part}` template for an animated one. Thread that
    // path into the config the binary reads so the mesh lands at the canonical
    // location the validator (and the served/published artifact set) expect.
    if let Some(mesh) = test_case.asset_kind.voxel_mesh_dest() {
        config["mesh"] = serde_json::json!(mesh);
    }
    // When a viewer is observing the run, seed the live-preview endpoint so the
    // sculpting binary streams each re-rendered frame back to the host. Absent for
    // an unobserved run (a plain `tcab run`/`tcab validate`), which seeds no `live`.
    if let Some(live) = live_preview {
        config["live"] = serde_json::json!({
            "endpoint": live.endpoint,
            "token": live.token,
        });
    }
    write_file(
        &repo.join(test_case.asset_kind.config_dest()),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(&config)
                .map_err(|err| { Error::Seeding(format!("serializing voxel config: {err}")) })?
        ),
    )?;

    // Seed each target's empty action log and a blank starting preview, so the run
    // starts from a known, empty state. The blank preview is a solid frame in the
    // configured background color — the same thing an empty scene renders to — that
    // the binary's on-request `render` command overwrites with the wgpu+Mesa mesh
    // render (sculpting operations only record; they render nothing). A static model
    // is one target; an animated model is one per declared part, at its
    // `{part}`-resolved paths.
    // A per-part animated kind seeds one target per declared part; a static or
    // **skinned** kind seeds a single target (the skinned exception — one whole-body
    // field, one mesh — even though it carries a `[model]` rig).
    let targets: Vec<(PathBuf, PathBuf)> = match &test_case.model {
        Some(model) if test_case.asset_kind.is_per_part() => model
            .parts
            .iter()
            .map(|part| {
                (
                    crate::test_case::part_path(&output.actions, &part.name),
                    crate::test_case::part_path(&tool.preview, &part.name),
                )
            })
            .collect(),
        _ => vec![(output.actions.clone(), tool.preview.clone())],
    };
    let empty_preview = blank_preview_png(background.fill())?;
    for (actions_rel, preview_rel) in targets {
        let actions_path = repo.join(&actions_rel);
        if let Some(parent) = actions_path.parent() {
            fs::create_dir_all(parent).map_err(seed_err)?;
        }
        write_file(&actions_path, "[]\n")?;

        let preview_path = repo.join(&preview_rel);
        if let Some(parent) = preview_path.parent() {
            fs::create_dir_all(parent).map_err(seed_err)?;
        }
        fs::write(&preview_path, &empty_preview).map_err(seed_err)?;
    }

    // Pre-seed `rig.json` from the required rig so the game-facing contract (the
    // required animation declarations) exists from t=0; the binary grows it as the
    // model invents parts and joints and authors the animations' F-curves.
    if let Some(model) = &test_case.model {
        let rig = model_to_rig(model);
        let mut json = serde_json::to_string_pretty(&rig)
            .map_err(|err| Error::Seeding(format!("serializing rig: {err}")))?;
        json.push('\n');
        write_file(&repo.join(crate::test_case::VOXEL_RIG_DEST), &json)?;
    }

    Ok(())
}

/// Build the `voxel-anim` binary's on-disk [`Rig`](test_cabinet_voxel::Rig) from a
/// resolved [`ModelSpec`](crate::test_case::ModelSpec), so the seeded `rig.json`
/// carries exactly the required parts, joints, and animation declarations (with
/// empty tracks — the model authors the F-curves at run time).
fn model_to_rig(model: &crate::test_case::ModelSpec) -> test_cabinet_voxel::Rig {
    use crate::test_case::{AxisSpec, DriveKindSpec, JointKindSpec};

    let parts = model
        .parts
        .iter()
        .map(|part| test_cabinet_voxel::Part {
            name: part.name.clone(),
            parent: part.parent.clone(),
            pivot: part.pivot,
        })
        .collect();
    let joints = model
        .joints
        .iter()
        .map(|joint| {
            let kind = match joint.kind {
                JointKindSpec::Rotation => test_cabinet_voxel::JointKind::Rotation,
                JointKindSpec::Translation => test_cabinet_voxel::JointKind::Translation,
            };
            let axis = match joint.axis {
                AxisSpec::X => test_cabinet_voxel::Axis::X,
                AxisSpec::Y => test_cabinet_voxel::Axis::Y,
                AxisSpec::Z => test_cabinet_voxel::Axis::Z,
            };
            let drive = match joint.drive {
                DriveKindSpec::Caller => test_cabinet_voxel::Drive::Caller,
                DriveKindSpec::Auto => test_cabinet_voxel::Drive::Auto,
            };
            test_cabinet_voxel::Joint {
                name: joint.name.clone(),
                part: joint.part.clone(),
                kind,
                axis,
                pivot: joint.pivot,
                min: joint.min,
                max: joint.max,
                rest: joint.rest,
                offset: joint.offset.unwrap_or([0.0; 3]),
                orient: joint.orient.unwrap_or([0.0; 3]),
                drive,
            }
        })
        .collect();
    // Seed the required animation DECLARATIONS (their joints set, empty tracks) so
    // the required animations exist in `rig.json` from t=0; the model fills the
    // F-curve tracks at run time.
    let animations = model
        .animations
        .iter()
        .map(|animation| test_cabinet_voxel::Animation {
            name: animation.name.clone(),
            period_ms: animation.period_ms,
            looping: animation.looping,
            auto_play: animation.auto_play,
            joints: animation.joints.clone(),
            tracks: Vec::new(),
        })
        .collect();
    test_cabinet_voxel::Rig {
        parts,
        joints,
        animations,
    }
}

/// Attach the live-preview `live` block to a seeded tool config when a viewer is
/// observing the run (a driver or the Tauri app), so the binary streams each
/// re-rendered preview back to the host. A no-op for an unobserved run.
fn add_live(config: &mut serde_json::Value, live: Option<&crate::preview::LivePreviewEndpoint>) {
    if let Some(live) = live {
        config["live"] = serde_json::json!({
            "endpoint": live.endpoint,
            "token": live.token,
        });
    }
}

/// Write a seeded tool config as pretty JSON (with a trailing newline) to `dest`.
fn write_config(repo: &Path, dest: &str, config: &serde_json::Value) -> Result<()> {
    let json = serde_json::to_string_pretty(config)
        .map_err(|err| Error::Seeding(format!("serializing {dest}: {err}")))?;
    write_file(&repo.join(dest), &format!("{json}\n"))
}

/// Seed a `ui`/`material` painted run's scaffold into `repo`: the `paint`/`texture`
/// tool config, a single empty (interleaved) action log, and a blank starting
/// preview per element/map so the model reads an empty surface before its first
/// operation. The emitted `ui.json`/`material.json` and the flattened PNGs are the
/// binary's to produce (not pre-seeded).
fn seed_paint_tool(
    test_case: &crate::TestCaseVersion,
    repo: &Path,
    live_preview: Option<&crate::preview::LivePreviewEndpoint>,
) -> Result<()> {
    let tool = test_case
        .tool
        .as_ref()
        .ok_or_else(|| Error::Seeding("painted case has no [tool]".to_string()))?;
    let output = test_case
        .output
        .as_ref()
        .ok_or_else(|| Error::Seeding("painted case has no [output]".to_string()))?;
    let preview = tool.preview.to_string_lossy().replace('\\', "/");
    let actions = output.actions.to_string_lossy().replace('\\', "/");

    // A painted run records ONE interleaved log; seed it once (empty).
    write_file(&repo.join(&output.actions), "[]\n")?;

    match test_case.asset_kind {
        crate::test_case::AssetKind::Ui => {
            let canvas = test_case
                .canvas
                .as_ref()
                .ok_or_else(|| Error::Seeding("`ui` case has no [canvas]".to_string()))?;
            let mut config = serde_json::json!({
                "width": canvas.width,
                "height": canvas.height,
                "background": canvas.background,
                "actions": actions,
                "preview": preview,
                "ui_json": crate::test_case::UI_JSON_DEST,
            });
            // The kit's elements (name/size + any fixed nine-slice), when declared.
            let elements = test_case
                .ui
                .as_ref()
                .map(|ui| ui.elements.as_slice())
                .unwrap_or(&[]);
            if !elements.is_empty() {
                config["elements"] = serde_json::json!(
                    elements
                        .iter()
                        .map(|el| {
                            let mut value = serde_json::json!({
                                "name": el.name,
                                "width": el.width,
                                "height": el.height,
                            });
                            if let Some(ns) = &el.nine_slice {
                                value["nine_slice"] = serde_json::json!({
                                    "left": ns.left,
                                    "right": ns.right,
                                    "top": ns.top,
                                    "bottom": ns.bottom,
                                });
                            }
                            value
                        })
                        .collect::<Vec<_>>()
                );
            }
            add_live(&mut config, live_preview);
            write_config(repo, crate::test_case::PAINT_CONFIG_DEST, &config)?;

            let fill = test_cabinet_model_core::PreviewBackground::parse(&canvas.background)
                .map_err(|err| Error::Seeding(format!("invalid canvas background: {err}")))?
                .fill();
            // A blank starting preview per element (or the single implicit element).
            if elements.is_empty() {
                seed_blank_png(repo, &tool.preview, canvas.width, canvas.height, fill)?;
            } else {
                for el in elements {
                    let rel = crate::test_case::element_path(&tool.preview, &el.name);
                    seed_blank_png(repo, &rel, el.width, el.height, fill)?;
                }
            }
        }
        // `material`.
        _ => {
            let material = test_case
                .material
                .as_ref()
                .ok_or_else(|| Error::Seeding("`material` case has no [material]".to_string()))?;
            let mut config = serde_json::json!({
                "size": material.size,
                "tile": material.tile,
                "maps": material.maps,
                "background": material.background,
                "actions": actions,
                "preview": preview,
                "material_json": crate::test_case::MATERIAL_JSON_DEST,
            });
            add_live(&mut config, live_preview);
            write_config(repo, crate::test_case::MATERIAL_CONFIG_DEST, &config)?;

            let fill = test_cabinet_model_core::PreviewBackground::parse(&material.background)
                .map_err(|err| Error::Seeding(format!("invalid material background: {err}")))?
                .fill();
            for map in &material.maps {
                let rel = crate::test_case::map_path(&tool.preview, map);
                seed_blank_png(repo, &rel, material.size, material.size, fill)?;
            }
        }
    }
    Ok(())
}

/// Seed a particle run's scaffold into `repo`: the `particle-2d`/`particle-3d` tool
/// config and an empty action log. The preview (`effect.gif`) and the emitted
/// `system.json` are the binary's on-request `render` to produce, so nothing else is
/// pre-seeded.
fn seed_particle_tool(
    test_case: &crate::TestCaseVersion,
    repo: &Path,
    live_preview: Option<&crate::preview::LivePreviewEndpoint>,
) -> Result<()> {
    let particle = test_case
        .particle
        .as_ref()
        .ok_or_else(|| Error::Seeding("particle case has no [particle]".to_string()))?;
    let tool = test_case
        .tool
        .as_ref()
        .ok_or_else(|| Error::Seeding("particle case has no [tool]".to_string()))?;
    let output = test_case
        .output
        .as_ref()
        .ok_or_else(|| Error::Seeding("particle case has no [output]".to_string()))?;
    let preview = tool.preview.to_string_lossy().replace('\\', "/");
    let actions = output.actions.to_string_lossy().replace('\\', "/");

    let mut config = serde_json::json!({
        "width": particle.width,
        "height": particle.height,
        "duration_ms": particle.duration_ms,
        "fps": particle.fps,
        "loop": particle.looping,
        "background": particle.background,
        "actions": actions,
        "preview": preview,
        "system": crate::test_case::PARTICLE_SYSTEM_DEST,
    });
    if let Some(depth) = particle.depth {
        config["depth"] = serde_json::json!(depth);
    }
    add_live(&mut config, live_preview);
    write_config(repo, test_case.asset_kind.config_dest(), &config)?;

    write_file(&repo.join(&output.actions), "[]\n")?;
    Ok(())
}

/// Seed an audio run's scaffold into `repo`: the `sfx-synth`/`sfx-sample`/`music`
/// tool config, an empty action log, and a blank starting waveform preview. The
/// rendered `clip.wav` (and `clip.mid` for `music`) are the binary's on-request
/// `render` to produce.
fn seed_audio_tool(
    test_case: &crate::TestCaseVersion,
    repo: &Path,
    live_preview: Option<&crate::preview::LivePreviewEndpoint>,
) -> Result<()> {
    let audio = test_case
        .audio
        .as_ref()
        .ok_or_else(|| Error::Seeding("audio case has no [audio]".to_string()))?;
    let tool = test_case
        .tool
        .as_ref()
        .ok_or_else(|| Error::Seeding("audio case has no [tool]".to_string()))?;
    let output = test_case
        .output
        .as_ref()
        .ok_or_else(|| Error::Seeding("audio case has no [output]".to_string()))?;
    let preview = tool.preview.to_string_lossy().replace('\\', "/");
    let actions = output.actions.to_string_lossy().replace('\\', "/");

    let mut config = serde_json::json!({
        "sample_rate": audio.sample_rate,
        "channels": audio.channels,
        "max_duration_ms": audio.max_duration_ms,
        "actions": actions,
        "preview": preview,
        "wav": crate::test_case::AUDIO_CLIP_WAV_DEST,
    });
    // The seeded config pins the pack the binary must load, under the key that
    // binary reads. A case's declaration lives in one ordered list for every test
    // type (`audio_packs`), so the pin is its first entry routed by the asset kind:
    // `sfx-sample` plays a sample pack, `music` an instrument bank, and `sfx-synth`
    // neither. The pin is what `check_identity` holds the loaded pack against, so a
    // staged pack that is not the declared one fails at load rather than rendering
    // the wrong sound.
    if let Some(pack) = test_case.audio_packs.first() {
        match test_case.asset_kind {
            crate::test_case::AssetKind::SfxSample => {
                config["sample_pack"] = serde_json::json!(pack);
            }
            crate::test_case::AssetKind::Music => {
                config["instrument_bank"] = serde_json::json!(pack);
            }
            _ => {}
        }
    }
    if test_case.asset_kind.emits_midi() {
        config["mid"] = serde_json::json!(crate::test_case::AUDIO_CLIP_MID_DEST);
    }
    add_live(&mut config, live_preview);
    write_config(repo, test_case.asset_kind.config_dest(), &config)?;

    write_file(&repo.join(&output.actions), "[]\n")?;
    // A blank waveform preview (transparent), overwritten by the binary's `render`.
    seed_blank_png(
        repo,
        &tool.preview,
        SEED_PREVIEW_SIZE,
        SEED_PREVIEW_SIZE,
        [0, 0, 0, 0],
    )?;
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

/// The message on the commit the seeder makes after laying the workspace down.
///
/// Exported because it is a **contract with the code analyzer**, not an implementation
/// detail. When a run record carries no seed commit, the analyzer's authored-set ladder
/// falls back to the tree's single root commit — and this message is the *only* thing
/// distinguishing a seed root from one the model created with its own `git init`. Taking
/// the root unconditionally would fail in the worst direction: the seeded set would
/// swallow the model's own work and the run would report near-zero authored code, stamped
/// as an exact measurement. Changing this string retires that fallback for every tree
/// seeded afterwards, so it lives in one place where both sides can see it.
pub const SEED_COMMIT_MESSAGE: &str = "Seed test case";

/// Initialize a fresh git repository with a single commit and no remote, and
/// return the initial commit hash.
fn init_repo(repo: &Path) -> Result<String> {
    git(repo, &["init", "--quiet", "--initial-branch", "main"])?;
    // Use repository-local identity so seeding does not depend on the host's
    // global git configuration.
    git(repo, &["config", "user.name", "The Test Cabinet"])?;
    git(repo, &["config", "user.email", "runs@test-cabinet.invalid"])?;
    // Directories that live in the workspace but are not part of what the model is
    // building, and so must never be tracked. See `exclude_from_git` for why this is
    // `.git/info/exclude` rather than a committed `.gitignore`.
    let mut excluded = Vec::new();
    // gg's own dotdir — the capture journal it streams *while the session runs*, its
    // assembled sidecar, its skills library. Unconditional: it is created during the
    // run, not by seeding, so there is nothing to probe for, and the exclusion has to
    // be in place before the model's first commit. Excluding it for a non-gg harness
    // (which writes nothing there) costs nothing.
    excluded.push(crate::gg::GG_WORKSPACE_DIR);
    // A game jam's seeded previous-entries folder is reference material, not part of
    // the submission.
    if repo
        .join(crate::execution::GAME_JAM_PRIOR_ENTRIES_DIR)
        .is_dir()
    {
        excluded.push(crate::execution::GAME_JAM_PRIOR_ENTRIES_DIR);
    }
    exclude_from_git(repo, &excluded)?;
    git(repo, &["add", "--all"])?;
    // Vendored code lives under `.tcab/` and carries `dist/` subtrees; a case's own
    // `.gitignore` (which ignores `dist/` for its build output) would otherwise
    // exclude it from `add --all`. Force it in so the produced repository is
    // self-contained and installable — an unforced `dist/` would leave the published
    // tree with a dependency whose code is missing. Both vendored trees need this for
    // the same reason and are listed together: the case's own declared packages, and
    // the run's engine runtime. `--force` on a path that is not present would error,
    // so each is guarded on the directory existing.
    for vendored in [
        crate::test_case::TCAB_VENDOR_DIR,
        crate::test_case::TCAB_ENGINE_DIR,
    ] {
        if repo.join(vendored).is_dir() {
            git(repo, &["add", "--force", vendored])?;
        }
    }
    git(
        repo,
        &["commit", "--quiet", "--message", SEED_COMMIT_MESSAGE],
    )?;
    let output = git(repo, &["rev-parse", "HEAD"])?;
    Ok(output.trim().to_string())
}

/// Git-ignore each of `dirs` — workspace-relative directory names — in the freshly
/// initialized `repo` by appending an anchored `/<dir>/` pattern to
/// `.git/info/exclude`.
///
/// `.git/info/exclude` rather than a committed `.gitignore` because `.gitignore` is the
/// model's file to own: a seeded entry there would show up in its diffs, could be edited
/// or deleted mid-run, and would ship in the published repository. The exclude file is
/// uncommitted, invisible to `git status`, and travels with the repo's `.git` into the run
/// container, so a single write at seed time governs the whole session — both the seed
/// commit's `add --all` and every `git add -A` the model itself runs.
///
/// Patterns are anchored (`/name/`) so they match only at the repository root: a `.gg/`
/// the model happens to create deeper in its own source tree is its business.
fn exclude_from_git(repo: &Path, dirs: &[&str]) -> Result<()> {
    if dirs.is_empty() {
        return Ok(());
    }
    let exclude = repo.join(".git").join("info").join("exclude");
    // `git init` creates `.git/info/exclude` with commented-out defaults; append so those
    // stay intact, and tolerate its absence in case a future git stops writing it.
    let mut contents = fs::read_to_string(&exclude).unwrap_or_default();
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    for dir in dirs {
        contents.push_str(&format!("/{dir}/\n"));
    }
    fs::write(&exclude, contents).map_err(seed_err)?;
    Ok(())
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
    // Name the command so a missing `git` binary reads as
    // "running `git init …`: No such file or directory" rather than a bare
    // "No such file or directory (os error 2)" with no hint at the cause.
    let output = command
        .output()
        .map_err(|err| seed_ctx(format!("running `git {}`", args.join(" ")), err))?;
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
        fs::create_dir_all(parent)
            .map_err(|err| seed_ctx(format!("creating `{}`", parent.display()), err))?;
    }
    // Name both paths: an `os error 2` here means the materialized source is
    // missing, and a bare "No such file or directory" hides which file.
    fs::copy(from, to).map_err(|err| {
        seed_ctx(
            format!("copying `{}` to `{}`", from.display(), to.display()),
            err,
        )
    })?;
    Ok(())
}

/// Write `contents` to a file, creating parent directories as needed. Used to
/// land a rendered `.hbs` spec at its destination.
fn write_file(to: &Path, contents: &str) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| seed_ctx(format!("creating `{}`", parent.display()), err))?;
    }
    fs::write(to, contents).map_err(|err| seed_ctx(format!("writing `{}`", to.display()), err))?;
    Ok(())
}

/// Copy a file or directory (recursively) to `to`.
fn copy_into(from: &Path, to: &Path) -> Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to)
            .map_err(|err| seed_ctx(format!("creating `{}`", to.display()), err))?;
        for entry in fs::read_dir(from)
            .map_err(|err| seed_ctx(format!("reading `{}`", from.display()), err))?
        {
            let entry =
                entry.map_err(|err| seed_ctx(format!("reading `{}`", from.display()), err))?;
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

/// Seed a game jam's earlier entries — the same model's previous runs of this jam,
/// under any harness — into
/// [`GAME_JAM_PRIOR_ENTRIES_DIR`](crate::execution::GAME_JAM_PRIOR_ENTRIES_DIR): one
/// Markdown file per prior entry (oldest first), plus an index `README.md` that says
/// what the folder is. The prompt's distinctness section points the model here.
///
/// The folder is reference material, not part of the submission, so it is left out
/// of git — [`init_repo`] adds it to `.git/info/exclude`, a local (uncommitted)
/// ignore that also keeps the model's own `git add -A` from committing it.
fn seed_prior_game_jam_entries(
    repo: &Path,
    entries: &[crate::run_record::PriorGameJamEntry],
) -> Result<()> {
    let dir = repo.join(crate::execution::GAME_JAM_PRIOR_ENTRIES_DIR);

    let mut index = String::from(
        "# Previous entries\n\n\
         These are the player-facing READMEs of games you — this model — have already built for \
         THIS game jam in earlier runs. They are reference material ONLY: this folder is \
         git-ignored and is not part of your submission.\n\n\
         Read them before you design your game, then build something genuinely distinct — a \
         different game, not a variation on any of these. One file per earlier entry, oldest \
         first:\n\n",
    );
    for (position, entry) in entries.iter().enumerate() {
        let number = position + 1;
        let file_name = format!("entry-{number:02}.md");
        index.push_str(&format!("- `{file_name}` — built {}\n", entry.finished_at));
        let body = format!(
            "# Earlier entry {number}\n\n_Built {}._\n\n{}\n",
            entry.finished_at,
            entry.readme.trim_end(),
        );
        write_file(&dir.join(&file_name), &body)?;
    }
    write_file(&dir.join("README.md"), &index)?;
    Ok(())
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

/// The host package store to vendor runtime packages from: the `TCAB_PACKAGE_STORE`
/// override when set, otherwise the baked-image default
/// ([`TCAB_PACKAGES_DIR`](crate::test_case::TCAB_PACKAGES_DIR)).
///
/// Shared with [`EngineCatalog::new`](crate::engine::EngineCatalog::new), which
/// reads an engine's version out of the same store, so a default-constructed
/// catalog and a default-constructed seeder can never disagree about which store
/// a run's engine comes from.
pub(crate) fn package_store_dir() -> PathBuf {
    std::env::var_os("TCAB_PACKAGE_STORE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(crate::test_case::TCAB_PACKAGES_DIR))
}

/// The host audio store a run's declared packs are staged out of: the
/// `TCAB_AUDIO_STORE` override when set, otherwise the baked-image default
/// ([`TCAB_AUDIO_STORE_DIR`](crate::test_case::TCAB_AUDIO_STORE_DIR)).
///
/// The same override shape as [`package_store_dir`], and for the same reason: the
/// driver image bakes one store, and a local checkout points at a fetched one
/// (`scripts/fetch-audio-store.sh`) rather than needing a credential of its own.
/// Unlike the package store, nothing here is vendored into the run repository —
/// [`crate::audio_stage`] materializes it in the container, outside the workspace.
pub(crate) fn audio_store_dir() -> PathBuf {
    std::env::var_os("TCAB_AUDIO_STORE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(crate::test_case::TCAB_AUDIO_STORE_DIR))
}

/// The `@test-cabinet/*` dependency names declared in a staged package's
/// `package.json` — the edges the vendoring closure walk follows. A package with
/// no such dependencies (or an unreadable/oddly-shaped manifest) contributes no
/// edges; only names under the `@test-cabinet/` scope are followed, since those
/// are the siblings that also live in the store.
fn tcab_dependencies(package_dir: &Path) -> Result<Vec<String>> {
    let manifest = package_dir.join("package.json");
    let raw = fs::read_to_string(&manifest).map_err(|err| {
        seed_ctx(
            format!("reading vendored package manifest `{}`", manifest.display()),
            err,
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|err| {
        Error::Seeding(format!(
            "vendored package manifest `{}` is not valid JSON: {err}",
            manifest.display()
        ))
    })?;
    let deps = value
        .get("dependencies")
        .and_then(|v| v.as_object())
        .into_iter()
        .flat_map(|map| map.keys())
        .filter(|name| name.starts_with("@test-cabinet/"))
        .cloned()
        .collect();
    Ok(deps)
}

/// The `version` a staged package declares, read out of its `package.json`.
///
/// The single source of truth for an engine's version: this is what a run records
/// as the engine version it was built on, and it is the same read
/// [`EngineCatalog`](crate::engine::EngineCatalog) performs to answer
/// [`ResolvedEngine::version`](crate::engine::ResolvedEngine::version) for the
/// case's declared range. The number is therefore never copied into `engine.toml`,
/// where it would be a second place to bump.
///
/// It is
/// held to being a real, non-empty string. A missing, non-string, or blank
/// `version` is a staging fault — a package built from a manifest that never got
/// one, or a store populated by hand — and the honest response is to refuse the
/// run: a recorded version is compared across months of runs, and a placeholder
/// would quietly claim two different engines were the same one.
pub(crate) fn staged_package_version(package_dir: &Path, package: &str) -> Result<String> {
    let manifest = package_dir.join("package.json");
    let raw = fs::read_to_string(&manifest).map_err(|err| {
        seed_ctx(
            format!("reading staged package manifest `{}`", manifest.display()),
            err,
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|err| {
        Error::Seeding(format!(
            "staged package manifest `{}` is not valid JSON: {err}",
            manifest.display()
        ))
    })?;
    value
        .get("version")
        .and_then(|version| version.as_str())
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            Error::Seeding(format!(
                "staged package `{package}` declares no `version` string in `{}` — the \
                 engine version is recorded on the run, so a run must never record a \
                 version that is not real; rebuild the package \
                 (`npm run build:packages`) and restage it \
                 (`node scripts/stage-tcab-packages.mjs`)",
                manifest.display(),
            ))
        })
}

/// The dependency spec a seeded workspace depends on the vendored engine by: an
/// in-repo relative `file:` path into
/// [`TCAB_ENGINE_DIR`](crate::test_case::TCAB_ENGINE_DIR).
///
/// The engine counterpart of `test_case::tcab_package_file_dep`, and relative for
/// the same reason: the produced tree is cloned, published, and validated
/// elsewhere, so a dependency that named a host path would resolve only on the
/// machine that seeded it.
fn engine_file_dep(package: &str) -> String {
    format!("file:./{}/{package}", crate::test_case::TCAB_ENGINE_DIR)
}

/// Declare the vendored engine in the seeded workspace's `package.json`, so the
/// build imports the runtime by its bare package name and `npm install` resolves
/// it out of the repository.
///
/// The rewrite preserves the file's key order and re-emits it with two-space
/// indentation and a trailing newline — the shape every case ships and the one
/// `npm` itself writes. That matters more here than anywhere else the harness
/// touches a file: this `package.json` is authored by a human, read by the model,
/// and diffed by everything downstream, so a re-serialization that sorted `name`
/// after `dependencies` would turn a one-line addition into a whole-file change
/// the model has to reason about.
///
/// A `package.json` that is absent, unreadable, or not a JSON object is an error
/// rather than something to invent: a case that supports any engine but
/// [`NONE_SLUG`](crate::engine::NONE_SLUG) must ship a workspace `package.json`
/// (resolution enforces it), so reaching here without one means the case and the
/// run disagree — and writing a fresh one would hand the model a workspace that
/// matches none of its specs.
fn add_engine_dependency(repo: &Path, package: &str) -> Result<()> {
    let manifest = repo.join("package.json");
    let raw = fs::read_to_string(&manifest).map_err(|err| {
        Error::Seeding(format!(
            "reading the seeded workspace `package.json` at `{}`: {err} — a case that \
             supports any engine other than `{}` must ship one, because the engine \
             dependency is written into it",
            manifest.display(),
            crate::engine::NONE_SLUG,
        ))
    })?;
    let mut document: JsonNode = serde_json::from_str(&raw).map_err(|err| {
        Error::Seeding(format!(
            "the seeded workspace `package.json` at `{}` is not valid JSON: {err}",
            manifest.display()
        ))
    })?;

    let JsonNode::Object(entries) = &mut document else {
        return Err(Error::Seeding(format!(
            "the seeded workspace `package.json` at `{}` is not a JSON object",
            manifest.display()
        )));
    };
    // Create `dependencies` when the case ships none — a workspace with only
    // `devDependencies`, say — so the engine still arrives. Appending it keeps the
    // rest of the file where the author put it.
    if !entries.iter().any(|(key, _)| key == "dependencies") {
        entries.push(("dependencies".to_string(), JsonNode::Object(Vec::new())));
    }
    let dependencies = entries
        .iter_mut()
        .find(|(key, _)| key == "dependencies")
        .map(|(_, value)| value)
        .expect("`dependencies` was just ensured to exist");
    let JsonNode::Object(dependencies) = dependencies else {
        return Err(Error::Seeding(format!(
            "the seeded workspace `package.json` at `{}` declares a `dependencies` \
             that is not an object",
            manifest.display()
        )));
    };
    set_entry(
        dependencies,
        package,
        JsonNode::Leaf(serde_json::Value::String(engine_file_dep(package))),
    );

    let mut rendered = serde_json::to_string_pretty(&document).map_err(|err| {
        Error::Seeding(format!(
            "re-serializing the seeded workspace `package.json` at `{}`: {err}",
            manifest.display()
        ))
    })?;
    rendered.push('\n');
    fs::write(&manifest, rendered)
        .map_err(|err| seed_ctx(format!("writing `{}`", manifest.display()), err))?;
    Ok(())
}

/// Set `key` in an ordered object, replacing the value of an existing key **in
/// place** rather than moving it to the end.
///
/// Position is content in a file a human authored: re-pointing a dependency that
/// is already declared should read as a changed line, not a moved one.
fn set_entry(entries: &mut Vec<(String, JsonNode)>, key: &str, value: JsonNode) {
    match entries.iter_mut().find(|(existing, _)| existing == key) {
        Some((_, slot)) => *slot = value,
        None => entries.push((key.to_string(), value)),
    }
}

/// A JSON document that remembers the order its object keys were written in.
///
/// [`serde_json::Value`] cannot: its map is a `BTreeMap`, so a parse-edit-write
/// round trip re-emits every object alphabetically. The `preserve_order` feature
/// that would change this is a *workspace-wide* switch on a shared dependency — it
/// would silently reorder every other JSON this workspace emits, including
/// generated contracts — which is far too broad a change to buy one file's key
/// order. Seeding rewrites exactly one file, the workspace `package.json` the
/// engine dependency is injected into, so it carries its own model instead.
///
/// Values are held as a tree rather than as raw text (`serde_json::value::RawValue`
/// would preserve the original bytes) so the whole document re-indents
/// consistently: a file authored with four spaces comes back out with the two the
/// rest of the tree uses, rather than half-and-half.
#[derive(Debug, Clone, PartialEq)]
enum JsonNode {
    /// An object, in the order its keys appeared.
    Object(Vec<(String, JsonNode)>),
    /// An array, in order.
    Array(Vec<JsonNode>),
    /// A string, number, boolean, or null — a value with no key order of its own,
    /// carried verbatim.
    Leaf(serde_json::Value),
}

impl<'de> Deserialize<'de> for JsonNode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        deserializer.deserialize_any(JsonNodeVisitor)
    }
}

/// Builds a [`JsonNode`] from whatever the document actually holds.
///
/// Every method is driven by `deserialize_any`, so the shape of the input decides
/// the arm — which is what lets a `package.json` be read without a schema for it.
struct JsonNodeVisitor;

impl<'de> Visitor<'de> for JsonNodeVisitor {
    type Value = JsonNode;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("any JSON value")
    }

    fn visit_map<A: MapAccess<'de>>(
        self,
        mut map: A,
    ) -> std::result::Result<Self::Value, A::Error> {
        let mut entries: Vec<(String, JsonNode)> = Vec::new();
        while let Some((key, value)) = map.next_entry::<String, JsonNode>()? {
            // A duplicate key is malformed JSON that parsers accept: keep the last
            // value (what every JSON reader resolves to) at the first key's
            // position (what a reader of the file sees).
            set_entry(&mut entries, &key, value);
        }
        Ok(JsonNode::Object(entries))
    }

    fn visit_seq<A: SeqAccess<'de>>(
        self,
        mut seq: A,
    ) -> std::result::Result<Self::Value, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element::<JsonNode>()? {
            items.push(item);
        }
        Ok(JsonNode::Array(items))
    }

    fn visit_unit<E: DeError>(self) -> std::result::Result<Self::Value, E> {
        Ok(JsonNode::Leaf(serde_json::Value::Null))
    }

    fn visit_bool<E: DeError>(self, value: bool) -> std::result::Result<Self::Value, E> {
        Ok(JsonNode::Leaf(value.into()))
    }

    fn visit_i64<E: DeError>(self, value: i64) -> std::result::Result<Self::Value, E> {
        Ok(JsonNode::Leaf(value.into()))
    }

    fn visit_u64<E: DeError>(self, value: u64) -> std::result::Result<Self::Value, E> {
        Ok(JsonNode::Leaf(value.into()))
    }

    fn visit_f64<E: DeError>(self, value: f64) -> std::result::Result<Self::Value, E> {
        Ok(JsonNode::Leaf(value.into()))
    }

    fn visit_str<E: DeError>(self, value: &str) -> std::result::Result<Self::Value, E> {
        Ok(JsonNode::Leaf(value.into()))
    }
}

impl Serialize for JsonNode {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            JsonNode::Object(entries) => {
                let mut map = serializer.serialize_map(Some(entries.len()))?;
                for (key, value) in entries {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
            JsonNode::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            JsonNode::Leaf(value) => value.serialize(serializer),
        }
    }
}

/// The edge length of a seeded blank voxel preview, matching the mesh renderer's
/// preview size so the placeholder frame is the same shape the binary re-renders.
const SEED_PREVIEW_SIZE: u32 = 512;

/// Encode a solid `SEED_PREVIEW_SIZE` square of the given straight-RGBA fill as PNG
/// bytes — the empty-scene placeholder preview seeded before a voxel run starts.
fn blank_preview_png(fill: [u8; 4]) -> Result<Vec<u8>> {
    solid_png(SEED_PREVIEW_SIZE, SEED_PREVIEW_SIZE, fill)
}

/// Encode a solid `width`×`height` rectangle of the given straight-RGBA fill as PNG
/// bytes.
fn solid_png(width: u32, height: u32, fill: [u8; 4]) -> Result<Vec<u8>> {
    let count = (width as usize) * (height as usize);
    let mut pixels = Vec::with_capacity(count * 4);
    for _ in 0..count {
        pixels.extend_from_slice(&fill);
    }
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|err| Error::Seeding(format!("writing blank preview header: {err}")))?;
        writer
            .write_image_data(&pixels)
            .map_err(|err| Error::Seeding(format!("writing blank preview data: {err}")))?;
    }
    Ok(buf)
}

/// Write a solid `width`×`height` blank preview PNG to `rel` under `repo`, creating
/// parent directories as needed — the empty starting preview a model reads before
/// its first painting/rendering operation.
fn seed_blank_png(repo: &Path, rel: &Path, width: u32, height: u32, fill: [u8; 4]) -> Result<()> {
    let path = repo.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(seed_err)?;
    }
    let bytes = solid_png(width, height, fill)?;
    fs::write(&path, &bytes).map_err(seed_err)?;
    Ok(())
}

/// Wrap an I/O error as a seeding error, prefixed with the operation that failed.
///
/// The bare OS message for the common failures here — a missing materialized file
/// or a missing `git` binary — is just "No such file or directory (os error 2)",
/// which names neither the file nor the operation. Carrying the context turns it
/// into "copying `…` to `…`: No such file…" or "running `git init`: No such file…",
/// so a failed seed says what it was doing rather than leaving it to be guessed.
fn seed_ctx(context: String, err: std::io::Error) -> Error {
    Error::Seeding(format!("{context}: {err}"))
}

#[cfg(test)]
#[path = "seeding.test.rs"]
mod tests;
