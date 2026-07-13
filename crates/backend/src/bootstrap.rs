//! One-time and periodic model-catalog maintenance run by the backend.
//!
//! On startup the backend seeds the curated model configs into an empty store
//! and re-associates any legacy `:free`-tagged runs to their base model. While it
//! runs it appends a price observation whenever a run completes and re-prices
//! every known model on a periodic schedule, so the catalog's comparable prices
//! track OpenRouter's — including promotional pricing — without the removed
//! `tcab catalog` step.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::metrics::TokenPrices;
use test_cabinet_core::model_id::{canonical_model_id, openrouter_price_id};
use test_cabinet_core::pricing::{ModelDetails, OpenRouterPrices};
use test_cabinet_core::run_record::{HarnessFamily, HarnessSlug};

use crate::db::{AliasEntry, Db, ModelConfigWrite, PriceWrite};
use crate::error::Result;
use crate::model_seed::SEED_MODELS;

/// How often the periodic refresher re-prices every known model.
const REFRESH_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Seed the curated model configs into the store when it holds none.
///
/// Idempotent: once the `model` table has any row this is a no-op, so operator
/// edits are never overwritten by a restart.
pub async fn seed_models_if_empty(db: &Db) -> Result<()> {
    if !db.list_model_configs().await?.is_empty() {
        return Ok(());
    }
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
    for seed in SEED_MODELS {
        db.upsert_model_config(ModelConfigWrite {
            slug: seed.slug.to_string(),
            display_name: seed.display_name.to_string(),
            provider: seed.provider.to_string(),
            provider_logo_url: None,
            provider_logo_svg: None,
            description_md: (!seed.description_md.is_empty())
                .then(|| seed.description_md.to_string()),
            openrouter_slug: seed.openrouter_slug.map(str::to_string),
            // The seed store is empty, so there is no run evidence yet; the
            // structural rule classifies every seed id unambiguously (a bare
            // `claude-*`/`gpt-*` to its native family, every `provider/model`
            // OpenRouter id to the OpenRouter family).
            aliases: seed
                .aliases
                .iter()
                .map(|alias| AliasEntry {
                    alias: alias.to_string(),
                    family: infer_alias_family(alias, None),
                })
                .collect(),
            now: now.clone(),
        })
        .await?;
    }
    tracing::info!(count = SEED_MODELS.len(), "seeded curated model catalog");
    Ok(())
}

/// Correct the harness family of curated aliases created before the
/// `harness_family` column existed (they carry the migration's `openrouter`
/// default). Idempotent: it computes each alias's true family from run evidence
/// (which harness family actually launched it) and a structural fallback, and
/// writes only the rows whose family differs — so a steady state converges and a
/// re-run is a no-op. Native-harness slugs (`claude-opus-4-8`, `gpt-5.5`) are the
/// rows this fixes; the OpenRouter `provider/model` slugs already hold the correct
/// default. Best-effort caller: a failure is logged, never fatal.
pub async fn backfill_alias_families(db: &Db) -> Result<usize> {
    // canonical id -> the distinct harness families that launched it, from runs.
    let mut run_families: HashMap<String, HashSet<HarnessFamily>> = HashMap::new();
    for (model_id, harness_slug) in db.distinct_run_models().await? {
        let harness = parse_harness(&harness_slug);
        run_families
            .entry(canonical_model_id(&model_id, harness))
            .or_default()
            .insert(harness.family());
    }

    let mut fixed = 0usize;
    for (id, alias, current) in db.all_alias_families().await? {
        let inferred = infer_alias_family(&alias, run_families.get(&alias));
        if inferred != current {
            db.set_alias_family(&id, inferred).await?;
            fixed += 1;
        }
    }
    if fixed > 0 {
        tracing::info!(fixed, "backfilled harness family for curated model aliases");
    }
    Ok(fixed)
}

/// Infer the harness family a canonical model id belongs to.
///
/// Run evidence wins when unambiguous: if runs launched this exact canonical id
/// under a single family, that is authoritative. Otherwise a structural rule
/// reads the id: an OpenRouter id carries a `provider/` segment; a bare id is a
/// provider-native slug, classified by its provider prefix (`gpt`/`o<n>`/`codex`
/// → Codex, `claude` → Claude, `gemini` → Antigravity), with everything else
/// defaulting to OpenRouter.
fn infer_alias_family(alias: &str, run_families: Option<&HashSet<HarnessFamily>>) -> HarnessFamily {
    if let Some(families) = run_families
        && families.len() == 1
    {
        return *families.iter().next().expect("len == 1");
    }
    if alias.contains('/') {
        return HarnessFamily::Openrouter;
    }
    let low = alias.to_ascii_lowercase();
    let is_openai = low.starts_with("gpt")
        || low.starts_with("codex")
        || low.starts_with("o1")
        || low.starts_with("o3")
        || low.starts_with("o4");
    if is_openai {
        HarnessFamily::Codex
    } else if low.starts_with("claude") {
        HarnessFamily::Claude
    } else if low.starts_with("gemini") {
        HarnessFamily::Antigravity
    } else {
        HarnessFamily::Openrouter
    }
}

/// Re-associate any legacy `:free`-tagged runs to their base model and re-price
/// them. Best-effort: a failure to fetch base prices leaves the affected runs'
/// costs unknown rather than blocking startup.
pub async fn normalize_free_runs(db: &Db, prices: &OpenRouterPrices) -> Result<()> {
    // Skip the OpenRouter fetch entirely when there is nothing to re-price — the
    // common case, so a normal boot costs no network.
    if !db.has_free_tag_candidates().await? {
        return Ok(());
    }
    let base_prices = fetch_base_prices(prices).await;
    let rewritten = db.normalize_free_model_ids(&base_prices).await?;
    if rewritten > 0 {
        tracing::info!(rewritten, "re-associated :free runs to their base model");
    }
    Ok(())
}

/// Record a run's model price when it completes: fetch the current OpenRouter
/// price for the run's model and append it to the history if it changed. Keyed by
/// the run's canonical model id; a curated model is priced against its configured
/// OpenRouter slug. Best-effort — errors are logged and dropped so completion is
/// never delayed or failed.
pub async fn observe_completion(
    db: &Db,
    prices: &OpenRouterPrices,
    model_id: &str,
    harness: HarnessSlug,
) {
    if let Err(err) = try_observe_completion(db, prices, model_id, harness).await {
        tracing::warn!(model_id, error = %err, "could not record model price on run completion");
    }
}

async fn try_observe_completion(
    db: &Db,
    prices: &OpenRouterPrices,
    model_id: &str,
    harness: HarnessSlug,
) -> Result<()> {
    let canonical = canonical_model_id(model_id, harness);
    let lookup = match db.openrouter_slug_for_alias(&canonical).await? {
        Some(slug) => slug,
        None => openrouter_price_id(model_id, harness),
    };
    let details = match prices.model_details(&lookup).await {
        Ok(details) => details,
        // A model absent from OpenRouter's catalog (a provider-native id, an
        // unlisted model) simply records no price.
        Err(_) => return Ok(()),
    };
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
    insert_if_changed(db, &canonical, &details, &now).await?;
    Ok(())
}

/// Re-price every known model from a single OpenRouter catalog fetch: each curated
/// model against its configured slug, and each model a run references against its
/// canonical lookup id. Appends an observation only where the price changed.
/// Returns how many models got a new observation.
pub async fn refresh_all_prices(db: &Db, prices: &OpenRouterPrices) -> Result<usize> {
    let catalog = match prices.all_model_details().await {
        Ok(catalog) => catalog,
        Err(err) => {
            tracing::warn!(error = %err, "periodic price refresh: could not fetch OpenRouter catalog");
            return Ok(0);
        }
    };
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;

    // (storage key = canonical id) -> OpenRouter lookup id.
    let mut targets: HashMap<String, String> = HashMap::new();
    for config in db.list_model_configs().await? {
        if let Some(slug) = &config.config.openrouter_slug {
            // Store curated observations under the configured slug (an alias), so
            // they merge with the model's other alias histories at compose time.
            targets.insert(slug.clone(), slug.clone());
        }
    }
    for (model_id, harness_slug) in db.distinct_run_models().await? {
        let harness = parse_harness(&harness_slug);
        let canonical = canonical_model_id(&model_id, harness);
        let lookup = match db.openrouter_slug_for_alias(&canonical).await? {
            Some(slug) => slug,
            None => openrouter_price_id(&model_id, harness),
        };
        targets.entry(canonical).or_insert(lookup);
    }

    let mut changed = 0usize;
    for (storage_key, lookup) in targets {
        if let Some(details) = catalog.get(&lookup)
            && insert_if_changed(db, &storage_key, details, &now).await?
        {
            changed += 1;
        }
    }
    Ok(changed)
}

/// Spawn the periodic price refresher, returning its task handle (kept alive for
/// the server's lifetime). It re-prices every known model every 24 hours; a fetch
/// failure is logged and retried on the next tick.
pub fn spawn_price_refresher(db: Arc<Db>, prices: OpenRouterPrices) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(REFRESH_INTERVAL).await;
            match refresh_all_prices(&db, &prices).await {
                Ok(changed) if changed > 0 => {
                    tracing::info!(changed, "periodic price refresh recorded new observations");
                }
                Ok(_) => {}
                Err(err) => tracing::warn!(error = %err, "periodic price refresh failed"),
            }
        }
    })
}

/// Insert a price observation for `model_id` when it differs from the latest one
/// on record (or there is none). Returns whether a row was inserted.
async fn insert_if_changed(
    db: &Db,
    model_id: &str,
    details: &ModelDetails,
    now: &str,
) -> Result<bool> {
    let prices = &details.prices;
    let changed = match db.latest_price(model_id).await? {
        Some(latest) => {
            latest.uncached_input != prices.uncached_input
                || latest.cached_input != prices.cached_input
                || latest.output != prices.output
        }
        None => true,
    };
    if changed {
        db.insert_price_observation(PriceWrite {
            model_id: model_id.to_string(),
            observed_at: now.to_string(),
            uncached_input: prices.uncached_input,
            cached_input: prices.cached_input,
            output: prices.output,
            context_length: details.context_length.and_then(|c| i64::try_from(c).ok()),
            released_at: details.released_at.clone(),
        })
        .await?;
    }
    Ok(changed)
}

/// Fetch OpenRouter's catalog as a base-price map keyed by OpenRouter id, for the
/// `:free` re-pricing. An empty map on failure leaves affected costs unknown.
async fn fetch_base_prices(prices: &OpenRouterPrices) -> HashMap<String, TokenPrices> {
    match prices.all_model_details().await {
        Ok(catalog) => catalog
            .into_iter()
            .map(|(id, details)| (id, details.prices))
            .collect(),
        Err(err) => {
            tracing::warn!(error = %err, ":free re-pricing: could not fetch OpenRouter catalog");
            HashMap::new()
        }
    }
}

/// Parse a stored harness slug into a [`HarnessSlug`], defaulting to Claude for an
/// unknown value (only affects the openrouter/-prefix canonicalization, which is
/// harness-agnostic).
fn parse_harness(slug: &str) -> HarnessSlug {
    HarnessSlug::ALL
        .into_iter()
        .find(|h| h.as_str() == slug)
        .unwrap_or(HarnessSlug::Claude)
}
