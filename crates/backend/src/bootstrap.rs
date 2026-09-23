//! One-time and periodic model-catalog maintenance run by the backend.
//!
//! On startup the backend seeds the curated model configs into an empty store
//! and re-associates any legacy `:free`-tagged runs to their base model. While it
//! runs it records a **billed rate** observation — what the official provider's
//! endpoint charges right now — whenever a run completes and re-observes every
//! known model on a periodic schedule, so the catalog's billed-rate series tracks
//! OpenRouter's — including promotional pricing — without the removed
//! `tcab catalog` step.
//!
//! A run's comparable cost is priced at the model developer's published **list
//! price**, curated on the model's catalog entry; the refresh records the billed
//! rate beside it and never rewrites what a run is scored at.
//!
//! A model is also priced the moment it first *appears* — when it is curated in the
//! app, when a launch binds it, and at startup for every known model still missing
//! an observation — so the catalog never shows a blank billed rate for a model the
//! system already knows about but has not finished a run with yet.

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
            // The seed takes the listing's own name; a mismatch is set by hand afterwards.
            provider_pin: None,
            // A seed carries no list price: a fresh deployment curates prices by
            // hand or by Fill from OpenRouter.
            list_price_input: None,
            list_price_cached_input: None,
            list_price_output: None,
            list_price_as_of: None,
            list_price_source: None,
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

/// Copy each legacy single-per-account `review_plan` into the multi-plan
/// `coverage_plan` table exactly once, carrying its combinations and cases as
/// one-off members of a "My coverage plan" (referencing no groups yet). Idempotent
/// via the legacy row's `migrated` flag: a restart re-runs nothing, and a migrated
/// plan the reviewer later deletes is not recreated. Best-effort caller: a failure
/// is logged, never fatal — the legacy row simply stays `migrated = false` for the
/// next startup to retry. Returns how many legacy plans were migrated.
pub async fn backfill_coverage_plans(db: &Db) -> Result<usize> {
    let legacy = db.unmigrated_review_plans().await?;
    if legacy.is_empty() {
        return Ok(0);
    }
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
    let mut migrated = 0usize;
    for plan in legacy {
        let coverage = crate::api::CoveragePlan {
            id: cuid2::create_id(),
            name: "My coverage plan".to_string(),
            // Normalized, not validated: a legacy row is a value this backend
            // already stored, not a request an operator is waiting on, and there is
            // no response a rejection could go back in. Refusing one here would
            // either abandon a reviewer's plan or stop a boot over a number the
            // console can no longer even submit. The range mirrors
            // `api::coverage`'s `MIN_RUNS_PER_CELL..=MAX_RUNS_PER_CELL`, which is
            // what bounds the plan once it is a coverage plan.
            runs_per_cell: plan.runs_per_cell.clamp(1, 100),
            combo_group_ids: Vec::new(),
            case_group_ids: Vec::new(),
            combos: plan.combos,
            cases: plan.cases,
            updated_at: now.clone(),
        };
        // A migrated plan starts under the default schedule, which is exactly the
        // behaviour the legacy `review_plan` had: cases outer, not paused, and no
        // automatic top-up. Migration must not change how an existing plan is fed —
        // the reviewer opts into scheduling afterwards, from the console.
        db.insert_coverage_plan(
            &plan.user_id,
            &coverage,
            &crate::db::CoveragePlanSchedule::default(),
        )
        .await?;
        db.mark_review_plan_migrated(&plan.user_id).await?;
        migrated += 1;
    }
    tracing::info!(
        migrated,
        "backfilled legacy review plans into coverage plans"
    );
    Ok(migrated)
}

/// Re-associate any legacy `:free`-tagged runs to their base model and re-price
/// them at the base model's **curated list price**. Costs no network: the
/// list-price map is built from the catalog itself. A `:free` run of a model with
/// no list price gets an unknown (`None`) comparable, exactly as an unfetchable
/// base price did before.
pub async fn normalize_free_runs(db: &Db) -> Result<()> {
    // Skip the read entirely when there is nothing to re-price — the common case,
    // so a normal boot costs nothing.
    if !db.has_free_tag_candidates().await? {
        return Ok(());
    }
    // Every alias of every fully priced curated config → its list price (per
    // token, as stored), keyed by canonical id.
    let mut list_prices: HashMap<String, TokenPrices> = HashMap::new();
    for stored in db.list_model_configs().await? {
        let config = &stored.config;
        let (Some(uncached_input), Some(cached_input), Some(output)) = (
            config.list_price_input,
            config.list_price_cached_input,
            config.list_price_output,
        ) else {
            continue;
        };
        let prices = TokenPrices {
            uncached_input: Some(uncached_input),
            cached_input: Some(cached_input),
            output: Some(output),
        };
        for alias in &stored.aliases {
            list_prices.insert(alias.alias.clone(), prices);
        }
    }
    let rewritten = db.normalize_free_model_ids(&list_prices).await?;
    if rewritten > 0 {
        tracing::info!(rewritten, "re-associated :free runs to their base model");
    }
    Ok(())
}

/// Record a run's **billed rate** when it completes: fetch the official
/// endpoint's current price for the run's model and append it to the history if
/// it changed. The observation sits beside the curated list price; the run itself
/// stays scored at the list price stamped at enqueue. Keyed by
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

/// The id to ask OpenRouter about for a run's model: a **curated** model's configured
/// OpenRouter slug when the run's canonical id is one of its aliases, else the canonical
/// id mapped onto OpenRouter's spelling.
///
/// The single spelling of this rule, shared by everything that reaches OpenRouter about one
/// model — the completion-time price observation, the periodic refresh, and the launch-time
/// context-window fill — so all three ask about the same model.
pub async fn openrouter_lookup_id(db: &Db, model_id: &str, harness: HarnessSlug) -> Result<String> {
    let canonical = canonical_model_id(model_id, harness);
    Ok(match db.openrouter_slug_for_alias(&canonical).await? {
        Some(slug) => slug,
        None => openrouter_price_id(model_id, harness),
    })
}

async fn try_observe_completion(
    db: &Db,
    prices: &OpenRouterPrices,
    model_id: &str,
    harness: HarnessSlug,
) -> Result<()> {
    let canonical = canonical_model_id(model_id, harness);
    let lookup = openrouter_lookup_id(db, model_id, harness).await?;
    let details = match prices.model_details(&lookup).await {
        Ok(details) => details,
        // A model absent from OpenRouter's catalog (a provider-native id, an
        // unlisted model) simply records no price.
        Err(_) => return Ok(()),
    };
    let details = with_official_endpoint(db, prices, &canonical, &lookup, &details).await?;
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
    insert_if_changed(db, &canonical, &details, &now).await?;
    Ok(())
}

/// Record a first price observation for every model in `targets` the catalog holds
/// none for, so a model's prices (and the catalog facts riding along on them) are on
/// record **before** anything needs them — the Models page, the public snapshot, and a
/// run's per-class cost split — rather than only once a run using it completes.
///
/// Seeding is deliberately *missing-only*: a model already on record is left to the
/// completion-time observation (which captures the price as it was when the run
/// actually ran) and the periodic refresh. That also makes the steady state free —
/// nothing is fetched when every target is already priced, so this costs a network
/// round trip exactly on the first sighting of a new model. A model on record with no
/// [provider pin](ModelDetails::provider_pin) counts as missing, so a pin is observed
/// as soon as the catalog meets a model rather than on the next refresh.
///
/// `targets` maps the storage key an observation is filed under to the OpenRouter id
/// to ask about. Returns how many models were seeded; a catalog fetch that fails
/// seeds nothing rather than failing the caller.
async fn seed_missing_prices(
    db: &Db,
    prices: &OpenRouterPrices,
    targets: HashMap<String, String>,
) -> Result<usize> {
    let mut missing: Vec<(String, String)> = Vec::new();
    for (storage_key, lookup) in targets {
        let pinned = db
            .latest_price(&storage_key)
            .await?
            .is_some_and(|latest| latest.provider_pin.is_some());
        if !pinned {
            missing.push((storage_key, lookup));
        }
    }
    if missing.is_empty() {
        return Ok(0);
    }
    let catalog = match prices.all_model_details().await {
        Ok(catalog) => catalog,
        Err(err) => {
            tracing::warn!(error = %err, "price seeding: could not fetch OpenRouter catalog");
            return Ok(0);
        }
    };
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
    let mut seeded = 0usize;
    for (storage_key, lookup) in missing {
        // A model OpenRouter does not list (a provider-native id, an unlisted model)
        // simply stays unpriced, exactly as at completion time.
        let Some(details) = catalog.get(&lookup) else {
            continue;
        };
        let details = with_official_endpoint(db, prices, &storage_key, &lookup, details).await?;
        if insert_if_changed(db, &storage_key, &details, &now).await? {
            seeded += 1;
        }
    }
    Ok(seeded)
}

/// Seed the **billed rates** of every model a launch binds, keyed by canonical id
/// exactly as the completion-time observation is. Called at enqueue so the catalog
/// knows a run's model from the moment the run exists — the console's Models page
/// and the run's own cost split do not have to wait for the run to finish. The
/// run's comparable cost is priced at the curated list price stamped at enqueue;
/// this only records the billed rate beside it.
///
/// It runs *before* the launch resolves its context window (`resolve_gg_model_facts`),
/// so a gg run against a never-before-seen model usually finds the window already in
/// the catalog rather than paying for a second, per-model fetch.
///
/// Best-effort: a failure is logged and dropped, never blocking a launch. An unpriced
/// model costs a cost split, not a run.
pub async fn seed_launch_prices(
    db: &Db,
    prices: &OpenRouterPrices,
    models: &[(String, HarnessSlug)],
) {
    let mut targets: HashMap<String, String> = HashMap::new();
    for (model_id, harness) in models {
        let canonical = canonical_model_id(model_id, *harness);
        if targets.contains_key(&canonical) {
            continue;
        }
        match openrouter_lookup_id(db, model_id, *harness).await {
            Ok(lookup) => {
                targets.insert(canonical, lookup);
            }
            Err(err) => {
                tracing::warn!(model_id, error = %err, "could not resolve a launch model's OpenRouter id");
            }
        }
    }
    match seed_missing_prices(db, prices, targets).await {
        Ok(seeded) if seeded > 0 => {
            tracing::info!(seeded, "seeded model prices for a launch");
        }
        Ok(_) => {}
        Err(err) => tracing::warn!(error = %err, "could not seed a launch's model prices"),
    }
}

/// Seed a just-configured curated model's **billed rate** from its OpenRouter
/// slug, so a model added or re-pointed in the app shows its billed rate at once
/// instead of `—` until its first run completes. Filed under the slug — the key
/// the periodic refresh uses — so the observation merges with the model's other
/// alias histories at compose time. The list price the run is scored at is the
/// curated one on the config itself, untouched here.
///
/// Best-effort: a failure is logged and dropped, so saving a model config never fails
/// on OpenRouter being unreachable.
pub async fn seed_curated_price(db: &Db, prices: &OpenRouterPrices, openrouter_slug: &str) {
    let targets = HashMap::from([(openrouter_slug.to_string(), openrouter_slug.to_string())]);
    match seed_missing_prices(db, prices, targets).await {
        Ok(seeded) if seeded > 0 => {
            tracing::info!(slug = openrouter_slug, "seeded prices for a curated model");
        }
        Ok(_) => {}
        Err(err) => {
            tracing::warn!(slug = openrouter_slug, error = %err, "could not seed a curated model's prices");
        }
    }
}

/// Seed a first **billed-rate** observation for every model the catalog knows but
/// holds none for: each curated model's configured OpenRouter slug, and each model
/// a stored run references. Run at startup, so a freshly seeded deployment
/// (curated configs inserted by [`seed_models_if_empty`], an empty `model_price`
/// table) records the billed rate before its first run rather than after its
/// first run *completes* — the per-class cost split on a live run depends on it.
///
/// Missing-only via `seed_missing_prices`: the steady-state boot reads the
/// database and fetches nothing. Returns how many models were seeded.
pub async fn seed_catalog_prices(db: &Db, prices: &OpenRouterPrices) -> Result<usize> {
    // (storage key) -> OpenRouter lookup id — the same keying `refresh_all_prices`
    // uses, so a startup observation lands exactly where the refresh would put it.
    let mut targets: HashMap<String, String> = HashMap::new();
    for config in db.list_model_configs().await? {
        if let Some(slug) = &config.config.openrouter_slug {
            targets.insert(slug.clone(), slug.clone());
        }
    }
    for (model_id, harness_slug) in db.distinct_run_models().await? {
        let harness = parse_harness(&harness_slug);
        let canonical = canonical_model_id(&model_id, harness);
        if targets.contains_key(&canonical) {
            continue;
        }
        let lookup = openrouter_lookup_id(db, &model_id, harness).await?;
        targets.insert(canonical, lookup);
    }
    seed_missing_prices(db, prices, targets).await
}

/// Re-observe the **billed rate** of every known model: each curated model against its
/// configured slug, and each model a run references against its canonical lookup id. The
/// catalog facts come from a single OpenRouter catalog fetch and the billed rate from each
/// model's endpoints listing, as the price of its official endpoint. Appends an observation
/// only where the billed rate (or a fact riding along on it) changed. The observation sits
/// beside the curated list price and never changes what a run is scored at. Returns how many
/// models got a new observation.
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
        let lookup = openrouter_lookup_id(db, &model_id, harness).await?;
        targets.entry(canonical).or_insert(lookup);
    }

    let mut changed = 0usize;
    for (storage_key, lookup) in targets {
        let Some(details) = catalog.get(&lookup) else {
            continue;
        };
        let details = with_official_endpoint(db, prices, &storage_key, &lookup, details).await?;
        if insert_if_changed(db, &storage_key, &details, &now).await? {
            changed += 1;
        }
    }
    Ok(changed)
}

/// `details` with its [provider pin](ModelDetails::provider_pin) and billed rate read from
/// `lookup`'s endpoints listing, which the models listing `details` came from does not
/// carry.
///
/// The billed rate is the official endpoint's price: the route of the catalog entry's
/// hand-set pin when it has one, else of the observed pin. A model with no priced official
/// route keeps the listing's headline price. A listing that cannot be read keeps the pin and
/// the prices last recorded under `storage_key`, so an unreachable endpoint never records a
/// model as having lost its official provider or swapped to the headline price.
async fn with_official_endpoint(
    db: &Db,
    prices: &OpenRouterPrices,
    storage_key: &str,
    lookup: &str,
    details: &ModelDetails,
) -> Result<ModelDetails> {
    match prices.model_launch_facts(lookup).await {
        Ok(facts) => {
            let hand_pin = db.provider_pin_for_alias(storage_key).await?;
            let billed = facts
                .official_prices(hand_pin.as_deref())
                .unwrap_or(details.prices);
            Ok(ModelDetails {
                prices: billed,
                provider_pin: facts.provider_pin,
                ..details.clone()
            })
        }
        Err(err) => {
            tracing::debug!(lookup, error = %err, "could not read a model's endpoints listing");
            let latest = db.latest_price(storage_key).await?;
            Ok(ModelDetails {
                prices: latest
                    .as_ref()
                    .map(|row| TokenPrices {
                        uncached_input: row.uncached_input,
                        cached_input: row.cached_input,
                        output: row.output,
                    })
                    .unwrap_or(details.prices),
                provider_pin: latest.and_then(|row| row.provider_pin),
                ..details.clone()
            })
        }
    }
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
///
/// "Differs" covers the catalog facts riding along on the observation — the context
/// window, release date, and accepted input modalities — not just the price triple.
/// A fact can change while the price holds still (a provider adds a longer route; a
/// model gains vision), and a fact nothing ever records is a fact gg cannot be told
/// at launch. The price *series* the catalog renders collapses consecutive-equal
/// price triples, so a fact-only observation adds no spurious price step.
async fn insert_if_changed(
    db: &Db,
    model_id: &str,
    details: &ModelDetails,
    now: &str,
) -> Result<bool> {
    let prices = &details.prices;
    let context_length = details.context_length.and_then(|c| i64::try_from(c).ok());
    let input_modalities = encode_modalities(&details.input_modalities);
    let provider_pin = details
        .provider_pin
        .clone()
        .filter(|provider| !provider.trim().is_empty());
    let changed = match db.latest_price(model_id).await? {
        Some(latest) => {
            latest.uncached_input != prices.uncached_input
                || latest.cached_input != prices.cached_input
                || latest.output != prices.output
                || latest.context_length != context_length
                || latest.released_at != details.released_at
                || latest.input_modalities != input_modalities
                || latest.provider_pin != provider_pin
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
            context_length,
            released_at: details.released_at.clone(),
            input_modalities,
            provider_pin,
        })
        .await?;
    }
    Ok(changed)
}

/// Encode observed input modalities for storage: a comma-separated lowercase list,
/// or `None` when OpenRouter reported none. `None` reads back as **unknown** rather
/// than "text only", so an unannotated model is never wrongly denied an image.
pub fn encode_modalities(modalities: &[String]) -> Option<String> {
    (!modalities.is_empty()).then(|| modalities.join(","))
}

/// Decode a stored [`encode_modalities`] list back into its parts, dropping blanks.
/// A `None` (or all-blank) column yields an empty list — unknown.
pub fn decode_modalities(stored: Option<&str>) -> Vec<String> {
    stored
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

/// Parse a stored harness slug into a [`HarnessSlug`], defaulting to Claude for an
/// unknown value (only affects the openrouter/-prefix canonicalization, which is
/// harness-agnostic).
fn parse_harness(slug: &str) -> HarnessSlug {
    // `from_wire` recognizes every variant (gg included), so canonicalization is
    // correct for a gg run rather than defaulting to Claude for an unknown slug.
    HarnessSlug::from_wire(slug).unwrap_or(HarnessSlug::Claude)
}

#[cfg(test)]
#[path = "bootstrap.test.rs"]
mod tests;
