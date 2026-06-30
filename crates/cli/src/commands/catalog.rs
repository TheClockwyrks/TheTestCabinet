//! `tcab catalog` — regenerate the bundled model dataset.
//!
//! Every host (the static site and the desktop/web consoles) ships a bundled
//! model catalog — `packages/ui/src/app/data/models.json` — so model metadata and
//! comparable prices render without a backend round-trip. This command rebuilds
//! that dataset from the on-disk model catalog (`models/<slug>.toml` + `.md`),
//! refreshing each model's OpenRouter prices, context window, and release date.
//!
//! The command needs no API keys; OpenRouter facts are looked up when a model
//! declares an OpenRouter slug and otherwise left null, so it stays runnable
//! offline. (The test-case half of the catalog is no longer emitted here: the
//! site's case data is served from the backend's public R2 snapshot, and the
//! consoles read the backend directly.)

use std::path::Path;

use anyhow::Context;
use serde::Serialize;
use test_cabinet_core::{Model, ModelCatalog, ModelDetails, OpenRouterPrices, TokenPrices};

use crate::cli::CatalogArgs;

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

/// Per-token prices for a model, mirrored from OpenRouter. Each price is `null`
/// when OpenRouter lists no usable value for that class.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelPrices {
    /// Price per uncached input token, or `null` when unknown.
    uncached_input: Option<f64>,
    /// Price per cached input token, or `null` when unknown.
    cached_input: Option<f64>,
    /// Price per output token, or `null` when unknown.
    output: Option<f64>,
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

/// Regenerate `models.json` from the on-disk model catalog, refreshing each
/// model's OpenRouter prices, context window, and release date.
pub async fn execute(args: CatalogArgs) -> anyhow::Result<()> {
    std::fs::create_dir_all(&args.data_dir)
        .with_context(|| format!("creating data directory {}", args.data_dir.display()))?;

    println!(
        "tcab catalog: writing models.json into {}",
        args.data_dir.display()
    );

    let models = build_models(&args.models_dir).await?;
    write_json(&args.data_dir.join("models.json"), &models)?;

    println!("  models.json: {} model(s)", models.len());
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

/// Serialize a value as pretty camelCase JSON and write it to `path`.
fn write_json<T: Serialize>(path: &Path, value: &T) -> anyhow::Result<()> {
    let json = serde_json::to_string_pretty(value)
        .with_context(|| format!("serializing {}", path.display()))?;
    std::fs::write(path, json).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}
