//! Lowering one [test case
//! definition](https://docs.testcabinet.ai/test-suites/test-case-definition/) onto
//! a runnable [`TestCaseVersion`].
//!
//! This is the seam that lets the existing run pipeline execute a suite. A suite
//! declares a smaller format than an authored test case does — no variants, no
//! scoring domains, none of the asset tables an asset-generation run needs — so
//! lowering maps what the definition declares, reads the prose and identity the
//! suite owns, renders the specifications the definition covers, and fills the rest
//! from the [defaults table](super::defaults). What comes out is exactly what
//! resolving an authored case produces, so seeding, prompt rendering, the
//! dispatcher, the driver and the run record need no suite branch of their own.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::engine::{EngineCatalog, EngineSelection, NONE_SLUG};
use crate::error::{Error, Result};
use crate::test_case::{
    AssetKind, BuildCommands, EngineSupport, EngineWorkspaces, SpecFile, SpecKind, TestCaseVersion,
    TestType, Variant, WorkspaceFile, escapes_folder, is_valid_slug,
};

use super::defaults::{SUITE_ASSET_DIMENSION, asset_defaults, default_audio_packs, default_domain};
use super::model::{
    SuiteAssetKind, SuiteDifficulty, SuiteManifest, SuiteRequirement, SuiteTestCaseDefinition,
    SuiteTestCaseType, VersionManifest,
};
use super::version::{AssetFolder, SpecificationFolder, SuiteVersion};

/// The slug of the single implicit variant every suite-defined test case runs.
///
/// A definition declares no variants, but the run pipeline selects exactly one
/// variant per run, so lowering synthesizes this one. It is never authored, so its
/// slug is fixed here.
pub const SUITE_VARIANT_SLUG: &str = "base";

/// The display name of the implicit variant.
const SUITE_VARIANT_NAME: &str = "Base";

/// The workspace-relative directory the rendered specifications are seeded under.
pub(super) const SPECS_DIR: &str = "specs";

/// The workspace-relative directory an end to end definition seeds the suite's
/// assets under. It mirrors the suite's own `assets/<asset-id>/` layout, so a
/// starter workspace reaches an asset by the id the suite names it by.
const ASSETS_DIR: &str = "assets";

/// The catalog identity of one definition: `<suite slug>-<definition file stem>`.
///
/// A suite-defined case and an authored case share one identity space — the same
/// definition-store key space, the same command-line name — so a definition's
/// identity is qualified by the suite that offers it. `carom/v1.0.0`'s
/// `test-cases/end-to-end.toml` is therefore `carom-end-to-end`.
pub fn catalog_identity(suite_slug: &str, definition_slug: &str) -> String {
    format!("{suite_slug}-{definition_slug}")
}

/// Everything lowering needs that is not the definition itself.
///
/// Grouped rather than passed as a dozen arguments because every field is read out
/// of the same loaded [`SuiteVersion`], and lowering a second definition of the
/// same version reads the identical set.
pub(crate) struct SuiteContext<'a> {
    /// The exported version's suite tree on the host.
    pub root: &'a Path,
    /// The version folder's name, carrying its leading `v`. This is the resolved
    /// [`TestCaseVersion::version`], so a suite-defined version is coordinated
    /// exactly like an authored one.
    pub version: &'a str,
    /// `suite.toml`, the identity of the suite the version belongs to.
    pub suite: &'a SuiteManifest,
    /// `version.toml`, the version's identity and the prose presenting it.
    pub manifest: &'a VersionManifest,
    /// Every specification the suite declares, flattened out of the folder tree in
    /// walk order.
    pub specifications: Vec<&'a SpecificationFolder>,
    /// The bundled assets, one per folder under `assets/`.
    pub assets: &'a [AssetFolder],
    /// Where rendered specification documents are written. Nothing under the suite
    /// checkout is touched — it is a submodule The Spec Cabinet owns — so the
    /// rendered documents land here and the resolved [`SpecFile`]s point at them.
    pub materials: &'a Path,
}

impl<'a> SuiteContext<'a> {
    /// Read the context for `version` out of a loaded version folder.
    pub(crate) fn new(
        root: &'a Path,
        version: &'a str,
        loaded: &'a SuiteVersion,
        materials: &'a Path,
    ) -> Self {
        let mut specifications = Vec::new();
        flatten_specifications(&loaded.specifications, &mut specifications);
        Self {
            root,
            version,
            suite: &loaded.suite,
            manifest: &loaded.manifest,
            specifications,
            assets: &loaded.assets,
            materials,
        }
    }

    /// Report a failure against `file`, a path relative to the version folder.
    fn invalid(&self, file: &str, detail: impl Into<String>) -> Error {
        Error::InvalidTestSuite {
            suite: self.suite.slug.clone(),
            version: self.version.to_string(),
            file: file.to_string(),
            detail: detail.into(),
        }
    }
}

/// Flatten the specification tree into walk order: a folder before the folders
/// nested inside it.
pub(super) fn flatten_specifications<'a>(
    folders: &'a [SpecificationFolder],
    into: &mut Vec<&'a SpecificationFolder>,
) {
    for folder in folders {
        into.push(folder);
        flatten_specifications(&folder.children, into);
    }
}

/// Which specifications one definition selects, and the ids it names that the suite
/// does not declare.
///
/// The `specifications` key selects whole specifications, and an absent key covers
/// every specification the suite declares — which is why it is not the same value as
/// an empty list. This is the one statement of that rule: lowering renders exactly
/// these documents, the prompt interpolates exactly their seeded paths, and the
/// validator runner records exactly their requirements, so the seeded files, the
/// prompt and the recorded outcomes can never describe different sets.
///
/// An id the suite does not declare is returned rather than decided: lowering and
/// prompt rendering refuse the definition by name, while the validator runner — which
/// only ever runs after lowering accepted the same definition — records what the
/// suite actually holds.
pub(super) fn select_specifications<'a>(
    declared: &[&'a SpecificationFolder],
    definition: &SuiteTestCaseDefinition,
) -> (Vec<&'a SpecificationFolder>, Vec<String>) {
    select_by_id(declared, definition, |folder| &folder.manifest.id)
}

/// [`select_specifications`] over whatever shape the declared specifications are
/// held in, each identified by `id`.
///
/// A suite version read back from a store holds its specifications as flattened
/// manifests rather than as a folder tree, and the rule has to be the same one
/// either way.
pub(super) fn select_by_id<'a, T: ?Sized>(
    declared: &[&'a T],
    definition: &SuiteTestCaseDefinition,
    id: impl Fn(&T) -> &str,
) -> (Vec<&'a T>, Vec<String>) {
    let Some(ids) = &definition.specifications else {
        return (declared.to_vec(), Vec::new());
    };
    let mut selected = Vec::with_capacity(ids.len());
    let mut missing = Vec::new();
    for wanted in ids {
        match declared.iter().copied().find(|spec| id(spec) == wanted) {
            Some(spec) => selected.push(spec),
            None => missing.push(wanted.clone()),
        }
    }
    (selected, missing)
}

/// What a definition's `type` resolves to, together with the asset it targets.
struct ResolvedType {
    /// The test type the run pipeline branches on.
    test_type: TestType,
    /// The asset kind, meaningful only for [`TestType::AssetGeneration`].
    asset_kind: AssetKind,
    /// The id of the asset under `assets/` an asset-producing definition targets.
    asset_id: Option<String>,
}

/// Map a definition's `type` and its type table onto the resolved test type and
/// asset kind.
///
/// The `performance`, `adversarial` and `puzzle` forms are stated as to be
/// determined on the definition page: their keys are not specified, so there is
/// nothing to lower and a definition declaring one is refused by name rather than
/// resolved into something invented.
fn resolve_type(
    context: &SuiteContext<'_>,
    file: &str,
    definition: &SuiteTestCaseDefinition,
) -> Result<ResolvedType> {
    let missing = |table: &str| context.invalid(file, format!("the [{table}] table is required"));
    let resolved = match definition.test_type {
        SuiteTestCaseType::EndToEnd => ResolvedType {
            test_type: TestType::EndToEnd,
            asset_kind: AssetKind::Sprite,
            asset_id: None,
        },
        SuiteTestCaseType::FullStack => ResolvedType {
            test_type: TestType::FullStack,
            asset_kind: AssetKind::Sprite,
            asset_id: None,
        },
        SuiteTestCaseType::Sprite => {
            let table = definition
                .sprite
                .as_ref()
                .ok_or_else(|| missing("sprite"))?;
            ResolvedType {
                test_type: TestType::AssetGeneration,
                asset_kind: if table.sheet {
                    AssetKind::SpriteSheet
                } else {
                    AssetKind::Sprite
                },
                asset_id: Some(table.id.clone()),
            }
        }
        SuiteTestCaseType::Voxel => {
            let table = definition.voxel.as_ref().ok_or_else(|| missing("voxel"))?;
            ResolvedType {
                test_type: TestType::AssetGeneration,
                asset_kind: if table.animated {
                    AssetKind::VoxelAnimation
                } else {
                    AssetKind::VoxelModel
                },
                asset_id: Some(table.id.clone()),
            }
        }
        SuiteTestCaseType::Blender => {
            let table = definition
                .blender
                .as_ref()
                .ok_or_else(|| missing("blender"))?;
            ResolvedType {
                test_type: TestType::AssetGeneration,
                asset_kind: AssetKind::BlenderProp,
                asset_id: Some(table.id.clone()),
            }
        }
        SuiteTestCaseType::Particle => {
            let table = definition
                .particle
                .as_ref()
                .ok_or_else(|| missing("particle"))?;
            ResolvedType {
                test_type: TestType::AssetGeneration,
                asset_kind: AssetKind::Particle2d,
                asset_id: Some(table.id.clone()),
            }
        }
        SuiteTestCaseType::Music => {
            let table = definition.music.as_ref().ok_or_else(|| missing("music"))?;
            ResolvedType {
                test_type: TestType::AssetGeneration,
                asset_kind: AssetKind::Music,
                asset_id: Some(table.id.clone()),
            }
        }
        SuiteTestCaseType::AudioFx => {
            let table = definition
                .audio_fx
                .as_ref()
                .ok_or_else(|| missing("audio-fx"))?;
            ResolvedType {
                test_type: TestType::AssetGeneration,
                asset_kind: AssetKind::SfxSynth,
                asset_id: Some(table.id.clone()),
            }
        }
        SuiteTestCaseType::Performance
        | SuiteTestCaseType::Adversarial
        | SuiteTestCaseType::Puzzle => {
            return Err(context.invalid(
                file,
                format!(
                    "a `{}` definition cannot be resolved: the keys of that type are specified as \
                     to be determined",
                    suite_type_name(definition.test_type)
                ),
            ));
        }
    };
    Ok(resolved)
}

/// The `type` value a definition declares, for an error that names it.
fn suite_type_name(test_type: SuiteTestCaseType) -> &'static str {
    match test_type {
        SuiteTestCaseType::EndToEnd => "end-to-end",
        SuiteTestCaseType::FullStack => "full-stack",
        SuiteTestCaseType::Sprite => "sprite",
        SuiteTestCaseType::Voxel => "voxel",
        SuiteTestCaseType::Blender => "blender",
        SuiteTestCaseType::Particle => "particle",
        SuiteTestCaseType::Music => "music",
        SuiteTestCaseType::AudioFx => "audio-fx",
        SuiteTestCaseType::Performance => "performance",
        SuiteTestCaseType::Adversarial => "adversarial",
        SuiteTestCaseType::Puzzle => "puzzle",
    }
}

/// The asset kind an `asset.toml` declares, as the resolved kind it produces.
fn asset_kind_of(kind: SuiteAssetKind, animated: bool) -> AssetKind {
    match kind {
        SuiteAssetKind::Sprite => AssetKind::Sprite,
        SuiteAssetKind::SpriteSheet => AssetKind::SpriteSheet,
        SuiteAssetKind::Voxel if animated => AssetKind::VoxelAnimation,
        SuiteAssetKind::Voxel => AssetKind::VoxelModel,
        SuiteAssetKind::Blender => AssetKind::BlenderProp,
        SuiteAssetKind::Particle => AssetKind::Particle2d,
        SuiteAssetKind::Music => AssetKind::Music,
        SuiteAssetKind::AudioFx => AssetKind::SfxSynth,
    }
}

/// The resolved difficulty string a definition's tier lowers to.
fn difficulty_of(difficulty: SuiteDifficulty) -> &'static str {
    match difficulty {
        SuiteDifficulty::Easy => "easy",
        SuiteDifficulty::Medium => "medium",
        SuiteDifficulty::Hard => "hard",
    }
}

/// Lower one definition onto the [`TestCaseVersion`] a run executes.
pub(crate) fn lower(
    context: &SuiteContext<'_>,
    definition_slug: &str,
    definition: &SuiteTestCaseDefinition,
) -> Result<TestCaseVersion> {
    let file = format!("test-cases/{definition_slug}.toml");
    let invalid = |detail: String| context.invalid(&file, detail);

    let slug = catalog_identity(&context.suite.slug, definition_slug);
    if !is_valid_slug(&slug) {
        return Err(invalid(format!(
            "identity `{slug}` is not a valid slug (lowercase letters, digits, and single \
             hyphens between them)"
        )));
    }

    let resolved_type = resolve_type(context, &file, definition)?;

    // The runtime cap bounds the harness session so a run can never continue
    // unbounded, exactly as for an authored case.
    if !(definition.max_runtime_hours.is_finite() && definition.max_runtime_hours > 0.0) {
        return Err(invalid(
            "max_runtime_hours must be a positive number".to_string(),
        ));
    }

    // The init command runs through `sh -c` in the run container, so a blank one is
    // refused exactly as an authored case's is.
    if let Some(init) = &definition.init
        && init.trim().is_empty()
    {
        return Err(invalid("init must not be empty when declared".to_string()));
    }

    // The prompt template is handed to the harness rendered rather than seeded, but
    // it is validated to exist and to stay inside the suite tree like every
    // other declared path.
    let prompt_rel = PathBuf::from(&definition.prompt);
    if escapes_folder(&prompt_rel) {
        return Err(invalid(format!(
            "prompt `{}` escapes the version folder",
            definition.prompt
        )));
    }
    let prompt_path = context.root.join(&prompt_rel);
    if !prompt_path.is_file() {
        return Err(invalid(format!(
            "prompt `{}` does not exist",
            definition.prompt
        )));
    }

    let common_specs = render_specifications(context, &file, definition)?;
    let engines = resolve_engines(context, &file, definition, resolved_type.test_type)?;
    let common_workspace =
        resolve_workspaces(context, &file, definition, &resolved_type, &engines)?;

    // `[build]` and `[toolchain]` belong to the code-producing types, which are the
    // only ones that ship a TypeScript build.
    let code_producing = matches!(
        resolved_type.test_type,
        TestType::EndToEnd | TestType::FullStack
    );
    let build = if code_producing {
        let build = definition
            .build
            .as_ref()
            .ok_or_else(|| invalid("the [build] table is required".to_string()))?;
        if build.install.trim().is_empty() || build.build.trim().is_empty() {
            return Err(invalid(
                "build.install and build.build must not be empty".to_string(),
            ));
        }
        Some(BuildCommands {
            install: build.install.clone(),
            build: build.build.clone(),
            module: None,
        })
    } else {
        None
    };
    let toolchain = if code_producing {
        let toolchain = definition
            .toolchain
            .as_ref()
            .ok_or_else(|| invalid("the [toolchain] table is required".to_string()))?;
        if toolchain.typecheck.trim().is_empty() {
            return Err(invalid("toolchain.typecheck must not be empty".to_string()));
        }
        Some(crate::toolchain::ToolchainCommands {
            typecheck: toolchain.typecheck.clone(),
            lint: toolchain.lint.clone(),
            format: toolchain.format.clone(),
            test: toolchain.test.clone(),
        })
    } else {
        None
    };

    // An asset-producing definition names an asset the suite bundles, and the
    // asset's declared kind must be the kind the definition's type produces — the
    // asset IS the subject, so a definition pointing at an asset of another kind is
    // asking for something the suite does not hold.
    if let Some(asset_id) = &resolved_type.asset_id {
        let asset = context
            .assets
            .iter()
            .find(|asset| asset.manifest.id == *asset_id)
            .ok_or_else(|| invalid(format!("asset `{asset_id}` is not declared under assets/")))?;
        let animated = resolved_type.asset_kind == AssetKind::VoxelAnimation;
        let declared = asset_kind_of(asset.manifest.kind, animated);
        if declared != resolved_type.asset_kind {
            return Err(invalid(format!(
                "asset `{asset_id}` is not the kind a `{}` definition produces",
                suite_type_name(definition.test_type)
            )));
        }
    }

    // The asset tables the format leaves out, plus the audio packs a run producing
    // sound is staged with.
    let defaults = asset_defaults(resolved_type.asset_kind);
    let asset_generation = resolved_type.test_type == TestType::AssetGeneration;
    let audio_packs = if asset_generation {
        defaults.audio_packs.clone()
    } else if resolved_type.test_type == TestType::FullStack {
        // A full-stack run produces its own sound during the run, and a case
        // carrying no `[audio]` table receives the pinned default pack set.
        default_audio_packs()
    } else {
        Vec::new()
    };

    Ok(TestCaseVersion {
        slug,
        version: context.version.to_string(),
        name: definition.name.clone(),
        difficulty: difficulty_of(definition.difficulty).to_string(),
        // The prose presenting a test case belongs to the suite version: a suite
        // version owns the material describing every case it offers.
        tags: context.manifest.tags.clone(),
        summary: Some(context.manifest.summary.clone()),
        description_path: Some(context.root.join(&context.manifest.description)),
        changelog_path: context.root.join(&context.manifest.changelog),
        root: context.root.to_path_buf(),
        prompt_path,
        max_runtime_seconds: crate::runtime_hours_to_seconds(definition.max_runtime_hours),
        test_type: resolved_type.test_type,
        // A suite still being iterated on keeps every case it offers out of a
        // deployment that has not opted in, so either declaration hides the case.
        experimental: context.manifest.experimental || definition.experimental,
        engine_format: true,
        build,
        toolchain,
        instrumentation: None,
        canvas: asset_generation.then(|| defaults.canvas.clone()).flatten(),
        tool: asset_generation.then(|| defaults.tool.clone()),
        output: asset_generation.then(|| defaults.output.clone()),
        contract: None,
        sandbox: None,
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: resolved_type.asset_kind,
        asset_dimension: SUITE_ASSET_DIMENSION,
        sheet: asset_generation.then(|| defaults.sheet.clone()).flatten(),
        voxel: asset_generation.then(|| defaults.voxel.clone()).flatten(),
        model: asset_generation.then(|| defaults.model.clone()).flatten(),
        ui: None,
        material: None,
        particle: asset_generation
            .then(|| defaults.particle.clone())
            .flatten(),
        audio: asset_generation.then(|| defaults.audio.clone()).flatten(),
        audio_packs,
        common_specs,
        common_workspace,
        init: definition.init.clone(),
        asset_paths: Vec::new(),
        packages: Vec::new(),
        engines,
        variants: vec![Variant {
            slug: SUITE_VARIANT_SLUG.to_string(),
            name: SUITE_VARIANT_NAME.to_string(),
            description: None,
            specs: Vec::new(),
            workspace: None,
            references: Vec::new(),
            proofs: Vec::new(),
            review_items: Vec::new(),
            domains: Vec::new(),
            voxel: None,
            reference_impls: BTreeMap::new(),
            showcase: None,
        }],
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: vec![default_domain()],
        cases: Vec::new(),
        errata: Vec::new(),
    })
}

/// The engines a run of this definition may select.
///
/// A code-producing definition is required to list them, and every slug must be one
/// the engine catalog knows; an empty list is refused by name rather than silently
/// standing in for the engineless run. An asset-producing definition selects no
/// engine, so it resolves to the engineless run alone.
fn resolve_engines(
    context: &SuiteContext<'_>,
    file: &str,
    definition: &SuiteTestCaseDefinition,
    test_type: TestType,
) -> Result<Vec<EngineSupport>> {
    if test_type == TestType::AssetGeneration {
        return Ok(vec![EngineSupport::unbounded(NONE_SLUG)]);
    }
    if definition.engines.is_empty() {
        return Err(context.invalid(
            file,
            format!(
                "a `{}` definition must list at least one engine in `engines`",
                suite_type_name(definition.test_type)
            ),
        ));
    }
    let catalog = EngineCatalog::default();
    let mut engines = Vec::with_capacity(definition.engines.len());
    for slug in &definition.engines {
        catalog
            .resolve(&EngineSelection::new(slug.clone()))
            .map_err(|err| context.invalid(file, err.to_string()))?;
        if engines
            .iter()
            .any(|engine: &EngineSupport| engine.slug == *slug)
        {
            return Err(context.invalid(file, format!("duplicate engine `{slug}`")));
        }
        engines.push(EngineSupport::unbounded(slug.clone()));
    }
    Ok(engines)
}

/// The starter workspace files a run is seeded with, keyed by engine.
///
/// `[workspaces]` names one directory per engine under `workspaces/<slug>/`, and
/// the resolved keys are exactly the definition's engines, so a run of any
/// supported engine finds an entry. An end to end definition additionally seeds the
/// suite's bundled assets, which is what lets the model write only code.
fn resolve_workspaces(
    context: &SuiteContext<'_>,
    file: &str,
    definition: &SuiteTestCaseDefinition,
    resolved_type: &ResolvedType,
    engines: &[EngineSupport],
) -> Result<EngineWorkspaces> {
    let mut workspaces = EngineWorkspaces::default();
    if resolved_type.test_type == TestType::AssetGeneration {
        return Ok(workspaces);
    }
    let declared = definition
        .workspaces
        .as_ref()
        .ok_or_else(|| context.invalid(file, "the [workspaces] table is required".to_string()))?;
    // The suite's assets, seeded under `assets/<asset-id>/` for an end to end
    // definition and seeded by nothing else: a full stack run produces its own.
    let assets = if resolved_type.test_type == TestType::EndToEnd {
        asset_workspace_files(context)?
    } else {
        Vec::new()
    };
    for engine in engines {
        let dir = declared.get(&engine.slug).ok_or_else(|| {
            context.invalid(
                file,
                format!(
                    "[workspaces] declares no directory for engine `{}`",
                    engine.slug
                ),
            )
        })?;
        let rel = PathBuf::from(dir);
        if escapes_folder(&rel) {
            return Err(context.invalid(
                file,
                format!("workspace `{dir}` escapes the version folder"),
            ));
        }
        let source = context.root.join(&rel);
        if !source.is_dir() {
            return Err(context.invalid(file, format!("workspace `{dir}` is not a directory")));
        }
        let mut files = enumerate_workspace(&source, &source)?;
        files.extend(assets.iter().cloned());
        files.sort_by(|a, b| a.dest.cmp(&b.dest));
        workspaces.insert(engine.slug.clone(), files);
    }
    Ok(workspaces)
}

/// Every file of the suite's bundled assets, as workspace files seeded under
/// `assets/<asset-id>/`.
fn asset_workspace_files(context: &SuiteContext<'_>) -> Result<Vec<WorkspaceFile>> {
    let mut files = Vec::new();
    for asset in context.assets {
        for name in &asset.manifest.files {
            let rel = PathBuf::from(name);
            if escapes_folder(&rel) {
                return Err(context.invalid(
                    &format!("{}/asset.toml", asset.dir),
                    format!("file `{name}` escapes the asset folder"),
                ));
            }
            let source_path = context.root.join(&asset.dir).join(&rel);
            if !source_path.is_file() {
                return Err(context.invalid(
                    &format!("{}/asset.toml", asset.dir),
                    format!("file `{name}` does not exist"),
                ));
            }
            files.push(WorkspaceFile {
                source_path,
                dest: Path::new(ASSETS_DIR).join(&asset.manifest.id).join(&rel),
            });
        }
    }
    Ok(files)
}

/// Enumerate a starter workspace directory into the files a run is seeded with,
/// each destination relative to the workspace directory itself.
fn enumerate_workspace(root: &Path, dir: &Path) -> Result<Vec<WorkspaceFile>> {
    let mut files = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            files.extend(enumerate_workspace(root, &path)?);
        } else if let Ok(dest) = path.strip_prefix(root) {
            files.push(WorkspaceFile {
                source_path: path.clone(),
                dest: dest.to_path_buf(),
            });
        }
    }
    Ok(files)
}

/// Render the specifications this definition covers into the files a run is seeded
/// with.
///
/// The `specifications` key selects whole specifications and defaults to every
/// specification the suite declares. Each selected one renders to a single Markdown
/// document — its prose followed by its requirements — written into the resolved
/// materials and seeded at `specs/<path>` from the path the specification declares,
/// so seeding needs no branch of its own.
fn render_specifications(
    context: &SuiteContext<'_>,
    file: &str,
    definition: &SuiteTestCaseDefinition,
) -> Result<Vec<SpecFile>> {
    let (selected, missing) = select_specifications(&context.specifications, definition);
    if let Some(id) = missing.first() {
        return Err(context.invalid(
            file,
            format!("specification `{id}` is not declared by the suite"),
        ));
    }

    let mut specs = Vec::with_capacity(selected.len());
    for folder in selected {
        let manifest_file = format!("{}/specification.toml", folder.dir);
        let dest_rel = PathBuf::from(&folder.manifest.path);
        if escapes_folder(&dest_rel) {
            return Err(context.invalid(
                &manifest_file,
                format!("path `{}` escapes specs/", folder.manifest.path),
            ));
        }
        let prose_path = context.root.join(&folder.prose);
        let prose = std::fs::read_to_string(&prose_path).map_err(|err| {
            context.invalid(
                &folder.prose,
                format!("could not read the specification prose: {err}"),
            )
        })?;
        let document =
            render_specification(&folder.manifest.id, &prose, &folder.manifest.requirements);

        let source_path = context.materials.join(SPECS_DIR).join(&dest_rel);
        if let Some(parent) = source_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&source_path, document)?;

        specs.push(SpecFile {
            source_path,
            dest: Path::new(SPECS_DIR).join(&dest_rel),
            kind: SpecKind::Spec,
        });
    }
    Ok(specs)
}

/// One specification as the single Markdown document a run reads: its prose,
/// followed by its requirements.
///
/// A requirement is written under its suite-wide `<specification id>/<requirement
/// id>` identity — the form a result records — so a reader of the seeded document
/// and a reader of a result name the same requirement.
fn render_specification(id: &str, prose: &str, requirements: &[SuiteRequirement]) -> String {
    let mut document = prose.trim_end().to_string();
    if requirements.is_empty() {
        document.push('\n');
        return document;
    }
    document.push_str("\n\n## Requirements\n");
    for requirement in requirements {
        document.push_str(&format!(
            "\n### {id}/{}\n\n{}\n",
            requirement.id,
            requirement.text.trim()
        ));
    }
    document
}
