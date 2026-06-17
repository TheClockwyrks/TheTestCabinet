//! `tcab catalog` — emit the static-site catalog datasets.
//!
//! The Test Cabinet's site is fully static: it has no backend to query for the
//! test cases or models it browses. This command bridges that gap by reading the
//! on-disk catalogs and writing two JSON datasets the site loads directly —
//! `test-cases.json` and `models.json` — together with any binary assets they
//! reference, copied under the site's `public/catalog/` tree so they are served
//! by URL.
//!
//! The test case dataset is built by reusing the production seeder and reference
//! renderer exactly as `tcab run` does, once per variant, so every variant's
//! `seededInputs` faithfully mirror what a real run of that variant receives: the
//! specification, seeded assets, and rendered reference screenshots. The reference
//! *source* mockups are withheld here just as they are from a run. The command
//! needs no API keys; OpenRouter prices are looked up when a model declares an
//! OpenRouter slug and otherwise left null.

use std::path::{Path, PathBuf};

use anyhow::{Context, anyhow};
use serde::Serialize;
use test_cabinet_core::{
    BrowserRenderer, FsRepoSeeder, Model, ModelCatalog, ModelDetails, OpenRouterPrices,
    ReferenceRenderer, RepoSeeder, SeedRequest, TestCaseCatalog, TestCaseVersion, TokenPrices,
    browser,
};

use crate::cli::CatalogArgs;

/// A single test case entry in `test-cases.json`.
///
/// One entry per slug, describing its latest metadata, the inputs a run is
/// seeded with, and the reference screenshots that serve as visual targets.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TestCaseEntry {
    /// The stable slug naming this test case.
    slug: String,
    /// Human-readable display name.
    name: String,
    /// Relative difficulty (for example `easy`, `medium`, `hard`).
    difficulty: String,
    /// Free-form classification tags.
    tags: Vec<String>,
    /// Short site-facing abstract shown on the catalog cards, or `null` when none
    /// is declared.
    summary: Option<String>,
    /// Inlined site-facing description Markdown, or `null` when none is declared.
    description: Option<String>,
    /// Every version of this case, newest first.
    versions: Vec<String>,
    /// The newest version, used as the metadata source for this entry.
    latest_version: String,
    /// Every variant the latest version offers, in declared order (the first is
    /// the default). Each carries the exact inputs a run of that variant is
    /// seeded with, so the site can browse all variants' specs — not just the
    /// default's.
    variants: Vec<VariantEntry>,
}

/// A single variant entry in `test-cases.json`.
///
/// Carries the inputs a run of this variant receives, seeded and rendered
/// exactly as `tcab seed --variant <slug>` materializes them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VariantEntry {
    /// The stable slug naming this variant.
    slug: String,
    /// Human-readable display name.
    name: String,
    /// Inlined site-facing description, or `null` when none is declared.
    description: Option<String>,
    /// The inputs a run of this variant is seeded with.
    seeded_inputs: Vec<SeededInput>,
    /// The reference screenshots rendered as visual targets for this variant.
    reference_screenshots: Vec<ReferenceScreenshot>,
}

/// A single seeded input — a file a run's repository is initialized with.
///
/// Text files are inlined so the site can show them directly; binary files
/// (images and other assets) are copied under `public/catalog/` and referenced by
/// URL instead.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeededInput {
    /// The file's path relative to the seeded repository root.
    path: String,
    /// Whether the file was inlined as text or copied as an image/binary asset.
    kind: InputKind,
    /// The inlined text, present for `text` inputs.
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    /// The public catalog URL, present for `image`/binary inputs.
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

/// Whether a seeded input was inlined as text or copied as a binary/image asset.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum InputKind {
    /// A text file, inlined into the dataset.
    Text,
    /// A binary or image file, copied to `public/catalog/` and linked by URL.
    Image,
}

/// A reference screenshot rendered as a visual target for a view.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceScreenshot {
    /// The view slug the screenshot corresponds to.
    view: String,
    /// The public catalog URL the screenshot was copied to.
    url: String,
}

/// A single model entry in `models.json`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelEntry {
    /// The stable slug naming this model.
    slug: String,
    /// Human-readable display name.
    name: String,
    /// The provider that serves the model.
    provider: String,
    /// The model's OpenRouter page, or `null` when it is not on OpenRouter.
    openrouter_url: Option<String>,
    /// Inlined site-facing description Markdown, or `null` when none is declared.
    description: Option<String>,
    /// The model ID strings as they appear in run records.
    model_ids: Vec<String>,
    /// Comparable per-token prices from OpenRouter, or `null` when they could not
    /// be resolved (no OpenRouter slug, or the lookup failed).
    prices: Option<ModelPrices>,
    /// The model's maximum context window in tokens as OpenRouter reports it, or
    /// `null` when it could not be resolved.
    context_length: Option<u64>,
    /// The model's release date as an RFC 3339 UTC timestamp, derived from
    /// OpenRouter's `created` timestamp, or `null` when it could not be resolved.
    released_at: Option<String>,
}

/// Per-token prices for a model, mirrored from OpenRouter.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelPrices {
    /// Price per uncached input token.
    uncached_input: f64,
    /// Price per cached input token.
    cached_input: f64,
    /// Price per output token.
    output: f64,
}

impl From<TokenPrices> for ModelPrices {
    fn from(prices: TokenPrices) -> Self {
        Self {
            uncached_input: prices.uncached_input,
            cached_input: prices.cached_input,
            output: prices.output,
        }
    }
}

/// Emit `test-cases.json` and `models.json` into the site, copying any binary
/// assets they reference under the site's `public/catalog/` tree.
pub async fn execute(args: CatalogArgs) -> anyhow::Result<()> {
    // Building the dataset wipes the catalog asset tree and regenerates every
    // reference screenshot from scratch, so a host without a working headless
    // browser would clear the screenshots and then fail to recreate them. Verify
    // the browser up front and bail before touching anything, leaving the
    // existing catalog intact, rather than degrading to absent screenshots.
    if let Err(detail) = browser::preflight() {
        return Err(anyhow!(
            "no usable browser for rendering reference screenshots: {detail}\n\
             `tcab catalog` regenerates every reference screenshot and will not run \
             without one. Install Node, Playwright, and a Chromium build, then retry."
        ));
    }

    let data_dir = args.site_dir.join("src").join("data");
    let public_dir = args.site_dir.join("public").join("catalog");
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("creating site data directory {}", data_dir.display()))?;

    println!("tcab catalog: writing datasets into {}", data_dir.display());

    let test_cases = build_test_cases(&catalog_root(), &public_dir)?;
    let models = build_models(&args.models_dir).await?;

    write_json(&data_dir.join("test-cases.json"), &test_cases)?;
    write_json(&data_dir.join("models.json"), &models)?;

    println!(
        "  test-cases.json: {} case(s)\n  models.json:     {} model(s)",
        test_cases.len(),
        models.len(),
    );
    Ok(())
}

/// Build the test case dataset by resolving each slug's latest version, seeding
/// it through the production seeder, and turning the seeded repository into the
/// site's `seededInputs`/`referenceScreenshots` shape.
fn build_test_cases(catalog_root: &Path, public_dir: &Path) -> anyhow::Result<Vec<TestCaseEntry>> {
    let catalog = TestCaseCatalog::new(catalog_root);
    let cases = catalog.list().context("listing test cases")?;

    // Start from a clean catalog asset tree so assets from cases, versions, or
    // variants that no longer exist (or that moved when the layout changed) do
    // not linger as orphans under `public/catalog/`.
    match std::fs::remove_dir_all(public_dir) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return Err(err)
                .with_context(|| format!("clearing catalog asset tree {}", public_dir.display()));
        }
    }

    let renderer = BrowserRenderer::new();
    // A scratch directory for the seeded repositories. Each version is seeded
    // into a fresh subfolder by the seeder; the whole tree is discarded once its
    // inputs have been read out, so the site only retains the dataset and the
    // copied public assets.
    let scratch = std::env::temp_dir().join("tcab-catalog");

    let mut entries = Vec::with_capacity(cases.len());
    for case in &cases {
        // `list()` only returns slugs that have at least one version, so the
        // newest is always present.
        let latest_version = case
            .versions
            .first()
            .ok_or_else(|| anyhow!("test case `{}` has no versions", case.slug))?
            .clone();
        let test_case = catalog
            .resolve(&case.slug, &latest_version)
            .with_context(|| format!("resolving {}@{}", case.slug, latest_version))?;

        let description = read_optional_markdown(test_case.description_path.as_deref())
            .with_context(|| format!("reading description for {}", case.slug))?;

        // Seed and render every variant, not just the default, so the dataset
        // carries the precise inputs a run of any variant receives. A version
        // always resolves with at least one variant.
        if test_case.variants.is_empty() {
            return Err(anyhow!("test case `{}` has no variants", case.slug));
        }
        let mut variants = Vec::with_capacity(test_case.variants.len());
        for variant in &test_case.variants {
            let entry = build_variant(&test_case, variant, &renderer, &scratch, public_dir)
                .with_context(|| format!("building variant `{}` of {}", variant.slug, case.slug))?;
            variants.push(entry);
        }

        entries.push(TestCaseEntry {
            slug: case.slug.clone(),
            name: test_case.name.clone(),
            difficulty: test_case.difficulty.clone(),
            tags: test_case.tags.clone(),
            summary: test_case.summary.clone(),
            description,
            versions: case.versions.clone(),
            latest_version,
            variants,
        });
    }

    Ok(entries)
}

/// Seed and render a single variant into a [`VariantEntry`].
///
/// The variant is seeded through the production seeder and reference renderer
/// exactly as `tcab seed --variant <slug>` does, so the recorded inputs mirror a
/// real run of that variant. Its public assets are namespaced by variant
/// (`/catalog/<slug>/<version>/<variant>/…`) so variant-specific files — such as
/// a per-variant `title` reference — never collide across variants.
fn build_variant(
    test_case: &TestCaseVersion,
    variant: &test_cabinet_core::Variant,
    renderer: &BrowserRenderer,
    scratch: &Path,
    public_dir: &Path,
) -> anyhow::Result<VariantEntry> {
    let specs = test_case.seeded_specs(variant);

    // A host without a headless browser renders no references; that is tolerated
    // and the screenshots are simply absent.
    let references = renderer
        .render_references(test_case, variant)
        .context("rendering references")?;
    let seeder = FsRepoSeeder::new(scratch);
    let seeded = seeder
        .seed(&SeedRequest {
            test_case,
            variant,
            specs: &specs,
            references: &references,
        })
        .context("seeding the variant")?;

    let variant_public = public_dir
        .join(&test_case.slug)
        .join(&test_case.version)
        .join(&variant.slug);
    let seeded_inputs = collect_seeded_inputs(
        &seeded.path,
        &variant_public,
        &test_case.slug,
        &test_case.version,
        &variant.slug,
    )
    .context("collecting seeded inputs")?;
    let reference_screenshots = collect_reference_screenshots(
        test_case,
        variant,
        &references,
        &variant_public,
        &test_case.slug,
        &test_case.version,
        &variant.slug,
    )
    .context("collecting reference screenshots")?;

    // The seeded repository was only needed to read the inputs out of; drop it so
    // the scratch tree does not accumulate across catalog runs.
    let _ = std::fs::remove_dir_all(&seeded.path);

    Ok(VariantEntry {
        slug: variant.slug.clone(),
        name: variant.name.clone(),
        description: variant.description.clone(),
        seeded_inputs,
        reference_screenshots,
    })
}

/// Walk a seeded repository and turn each file into a [`SeededInput`].
///
/// The `reference/` screenshots are excluded here because they are surfaced
/// separately as `referenceScreenshots`; everything else the run is seeded with
/// (the specification and any assets) is included. Text files are inlined; binary
/// files are copied under `public/catalog/<slug>/<version>/` and linked by URL.
/// The `.git` directory the seeder creates is skipped — it is run plumbing, not a
/// model-facing input.
fn collect_seeded_inputs(
    repo: &Path,
    public_dir: &Path,
    slug: &str,
    version: &str,
    variant: &str,
) -> anyhow::Result<Vec<SeededInput>> {
    let mut files = Vec::new();
    walk_files(repo, repo, &mut files)?;
    // A stable order makes the dataset deterministic regardless of how the
    // filesystem enumerated the tree.
    files.sort();

    let mut inputs = Vec::with_capacity(files.len());
    for relative in files {
        let components: Vec<_> = relative.iter().filter_map(|c| c.to_str()).collect();
        // Skip git plumbing and the reference screenshots (surfaced separately).
        if components.first() == Some(&".git") || components.first() == Some(&"reference") {
            continue;
        }
        let absolute = repo.join(&relative);
        let rel_str = unix_path(&relative);
        let bytes = std::fs::read(&absolute)
            .with_context(|| format!("reading seeded input {}", absolute.display()))?;

        if let Some(text) = decode_text(&bytes) {
            inputs.push(SeededInput {
                path: rel_str,
                kind: InputKind::Text,
                text: Some(text),
                url: None,
            });
        } else {
            let url = copy_to_public(&absolute, public_dir, &relative, slug, version, variant)?;
            inputs.push(SeededInput {
                path: rel_str,
                kind: InputKind::Image,
                text: None,
                url: Some(url),
            });
        }
    }
    Ok(inputs)
}

/// Copy each rendered reference screenshot under `public/catalog/` and describe
/// it by view and URL. Views that did not render (no browser) are simply absent.
fn collect_reference_screenshots(
    test_case: &TestCaseVersion,
    variant: &test_cabinet_core::Variant,
    references: &[test_cabinet_core::RenderedReference],
    public_dir: &Path,
    slug: &str,
    version: &str,
    variant_slug: &str,
) -> anyhow::Result<Vec<ReferenceScreenshot>> {
    // Emit in the manifest's declared view order for the rendered variant — the
    // common references followed by the variant's own — including only views that
    // actually rendered, so the site shows references in a stable, intended order
    // rather than render-completion order.
    let mut screenshots = Vec::new();
    for view in &test_case.references_for(variant) {
        let Some(rendered) = references.iter().find(|r| r.view == view.view) else {
            continue;
        };
        let name = format!("{}.png", rendered.view);
        let relative = Path::new("reference").join(&name);
        let url = copy_to_public(
            &rendered.image_path,
            public_dir,
            &relative,
            slug,
            version,
            variant_slug,
        )?;
        screenshots.push(ReferenceScreenshot {
            view: rendered.view.clone(),
            url,
        });
    }
    Ok(screenshots)
}

/// Copy `source` to `public_dir/<relative>` and return its public URL
/// (`/catalog/<slug>/<version>/<variant>/<relative>`). The variant segment
/// namespaces each variant's assets so variant-specific files never collide.
/// Parent directories are created as needed.
fn copy_to_public(
    source: &Path,
    public_dir: &Path,
    relative: &Path,
    slug: &str,
    version: &str,
    variant: &str,
) -> anyhow::Result<String> {
    let dest = public_dir.join(relative);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating catalog asset directory {}", parent.display()))?;
    }
    std::fs::copy(source, &dest)
        .with_context(|| format!("copying catalog asset to {}", dest.display()))?;
    Ok(format!(
        "/catalog/{slug}/{version}/{variant}/{}",
        unix_path(relative)
    ))
}

/// Recursively collect every file path under `dir`, relative to `root`.
fn walk_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    for entry in
        std::fs::read_dir(dir).with_context(|| format!("reading directory {}", dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            walk_files(root, &path, out)?;
        } else {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| anyhow!("{} is outside {}", path.display(), root.display()))?;
            out.push(relative.to_path_buf());
        }
    }
    Ok(())
}

/// Build the model dataset from the model catalog, resolving OpenRouter URLs and
/// comparable prices where an OpenRouter slug is declared.
async fn build_models(models_dir: &Path) -> anyhow::Result<Vec<ModelEntry>> {
    let catalog = ModelCatalog::new(models_dir);
    let models = catalog.list().context("listing models")?;

    // Prices are looked up against the same OpenRouter catalog `tcab run` uses.
    // A failed lookup degrades to `null` prices rather than failing the command,
    // so `tcab catalog` stays runnable offline and without keys.
    let prices_source = OpenRouterPrices::new();

    let mut entries = Vec::with_capacity(models.len());
    for model in &models {
        let description = read_optional_markdown(model.description_path.as_deref())
            .with_context(|| format!("reading description for model {}", model.slug))?;
        // A single OpenRouter lookup yields prices, context window, and release
        // date together; an absent slug or failed lookup leaves them all null.
        let details = resolve_details(&prices_source, model).await;
        entries.push(ModelEntry {
            slug: model.slug.clone(),
            name: model.name.clone(),
            provider: model.provider.clone(),
            openrouter_url: model
                .openrouter_slug
                .as_ref()
                .map(|slug| format!("https://openrouter.ai/{slug}")),
            description,
            model_ids: model.model_ids.clone(),
            prices: details.as_ref().map(|details| details.prices.into()),
            context_length: details.as_ref().and_then(|details| details.context_length),
            released_at: details.and_then(|details| details.released_at),
        });
    }
    Ok(entries)
}

/// Resolve a model's OpenRouter facts — comparable prices, context window, and
/// release date — returning `None` when the model declares no OpenRouter slug or
/// when the lookup fails.
async fn resolve_details(source: &OpenRouterPrices, model: &Model) -> Option<ModelDetails> {
    let slug = model.openrouter_slug.as_ref()?;
    match source.model_details(slug).await {
        Ok(details) => Some(details),
        Err(err) => {
            eprintln!(
                "warning: could not fetch OpenRouter details for `{slug}` ({err}); \
                 recording null prices for model `{}`",
                model.slug
            );
            None
        }
    }
}

/// Read a Markdown file into a string, returning `None` when no path is given.
fn read_optional_markdown(path: Option<&Path>) -> anyhow::Result<Option<String>> {
    match path {
        Some(path) => {
            let text = std::fs::read_to_string(path)
                .with_context(|| format!("reading {}", path.display()))?;
            Ok(Some(text))
        }
        None => Ok(None),
    }
}

/// Decode bytes as UTF-8 text, returning `None` when the content is not valid
/// UTF-8 or contains a NUL byte. This is the same heuristic common tools use to
/// tell text from binary: a NUL byte is a reliable binary signal, and assets the
/// site inlines (specifications, source mockups, code) are all UTF-8 text.
fn decode_text(bytes: &[u8]) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes.to_vec()).ok()
}

/// Render a relative path with forward slashes so dataset paths and URLs are
/// stable across platforms.
fn unix_path(path: &Path) -> String {
    path.components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}

/// Serialize a value as pretty camelCase JSON and write it to `path`.
fn write_json<T: Serialize>(path: &Path, value: &T) -> anyhow::Result<()> {
    let json = serde_json::to_string_pretty(value)
        .with_context(|| format!("serializing {}", path.display()))?;
    std::fs::write(path, json).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

/// Locate the test case catalog root, honoring `TCAB_TEST_CASES_DIR` like the
/// other commands and otherwise defaulting to `test-cases`.
fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}
