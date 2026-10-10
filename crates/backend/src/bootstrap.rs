//! One-time and periodic model-catalog maintenance run by the backend.
//!
//! On startup the backend seeds the curated model configs into an empty store
//! and re-associates any legacy `:free`-tagged runs to their base model.
//!
//! A model has one price: the **list price** on its catalog entry, which a run's
//! comparable cost is computed from. A list price read from OpenRouter is resolved
//! by one flow ([`ModelLaunchFacts::list_price`](test_cabinet_core::ModelLaunchFacts::list_price)):
//! the standard endpoint of the developer provider set by hand on the entry, else
//! of the provider the model id's author segment names, else the model's own
//! price in OpenRouter's models listing (the `pricing` field of its `/models`
//! entry). Every entry's list price is refreshed by that flow shortly after
//! startup, every 24 hours, and on request
//! ([`refresh_list_prices`]); a curated entry that carries none when a launch
//! binds it has one filled right then ([`list_price_for_launch`]), so the first
//! run of a freshly added model is not refused over a figure OpenRouter publishes.
//! A refresh changes catalog entries only: a run keeps the cost it was scored at.
//!
//! Beside the list price the backend observes each model's **catalog facts** on
//! OpenRouter: its context window, release date, input modalities and developer
//! provider. They are observed the moment a model first *appears* (when it is
//! curated in the app, when a launch binds it, and at startup for every known
//! model still missing an observation), when a run completes, and on the periodic
//! schedule, so the catalog and a launch never wait for a run to finish to know
//! them.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_core::metrics::TokenPrices;
use test_cabinet_core::model_id::{canonical_model_id, openrouter_price_id};
use test_cabinet_core::pricing::{ListRate, ModelDetails, OpenRouterPrices};
use test_cabinet_core::run_record::{HarnessFamily, HarnessSlug};

use crate::db::{AliasEntry, Db, ListPriceWrite, ModelConfigWrite, PriceWrite};
use crate::error::Result;
use crate::model_seed::SEED_MODELS;

/// How often the periodic refresher re-reads every list price and every known
/// model's catalog facts.
const REFRESH_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// The `list_price_source` of a list price read from OpenRouter (the fill at
/// enqueue, or a refresh of every entry), as opposed to `hand` for a set the
/// operator entered.
pub const LIST_PRICE_SOURCE_OPENROUTER: &str = "openrouter";

/// The list price a launch's model is scored at, filling a curated entry that carries
/// none from OpenRouter, or the reason the launch is refused.
///
/// The catalog answers first ([`Db::list_price_for_run_model`]). A curated entry with no
/// list price gets one now, resolved by the
/// [list-price flow](test_cabinet_core::ModelLaunchFacts::list_price) with the entry's
/// hand-set developer provider, and written onto the entry dated today and sourced
/// [`LIST_PRICE_SOURCE_OPENROUTER`]. The launch is stamped with the same figures. The
/// entry is looked up by its OpenRouter slug, else by the launch's model id mapped onto
/// OpenRouter's spelling.
///
/// `on_fill` is called once the entry has been written: the catalog changed, and the
/// caller owns what follows from that (the public snapshot's refresh). It is called from
/// here, at the moment of the write, so a launch that fills one model and is then
/// refused over another still reports the change it made.
///
/// A model the catalog has no entry for is refused: there is nothing to fill. So is a
/// curated model OpenRouter yields no complete rate for, with the lookup's
/// failure named beside the catalog's reason, so the operator knows both what to set and
/// why the fill could not.
///
/// `Ok(Ok(_))` is the price to stamp; `Ok(Err(reason))` refuses the launch; `Err` is a
/// database failure, which is an unknown rather than "no price".
pub async fn list_price_for_launch(
    db: &Db,
    prices: &OpenRouterPrices,
    model_id: &str,
    harness: HarnessSlug,
    on_fill: &(dyn Fn() + Sync),
) -> Result<std::result::Result<TokenPrices, String>> {
    let reason = match db.list_price_for_run_model(model_id, harness).await? {
        Ok(prices) => return Ok(Ok(prices)),
        Err(reason) => reason,
    };
    let canonical = canonical_model_id(model_id, harness);
    let Some(entry) = db.model_config_for_alias(&canonical).await? else {
        return Ok(Err(reason));
    };
    let lookup = entry
        .config
        .openrouter_slug
        .clone()
        .unwrap_or_else(|| openrouter_price_id(model_id, harness));
    let refusal = |why: String| {
        format!(
            "model `{canonical}` ({}) has no list price, and none could be filled from \
             OpenRouter ({why}); set it on the model's catalog entry (the Models section) \
             to run it",
            entry.config.display_name
        )
    };
    let resolved = match prices
        .list_price(&lookup, hand_set_provider(&entry.config))
        .await
    {
        Ok(Some(resolved)) => resolved,
        Ok(None) => {
            return Ok(Err(refusal(format!(
                "OpenRouter lists no complete rate for it as `{lookup}`"
            ))));
        }
        Err(err) => {
            return Ok(Err(refusal(format!(
                "looking it up as `{lookup}` failed: {err}"
            ))));
        }
    };
    let (as_of, now) = list_price_stamp()?;
    db.set_list_price(list_price_write(
        &entry.config.slug,
        resolved.rate,
        as_of,
        now,
    ))
    .await?;
    tracing::info!(
        slug = entry.config.slug,
        lookup,
        step = resolved.step.as_str(),
        provider = resolved.provider.as_deref(),
        uncached_input = resolved.rate.uncached_input,
        cached_input = resolved.rate.cached_input,
        output = resolved.rate.output,
        "filled a model's list price from OpenRouter at enqueue"
    );
    on_fill();
    Ok(Ok(resolved.rate.token_prices()))
}

/// The developer provider set by hand on a catalog entry, or `None` when the entry
/// sets none (a blank one included).
fn hand_set_provider(config: &test_cabinet_entities::model::Model) -> Option<&str> {
    config
        .provider_pin
        .as_deref()
        .filter(|provider| !provider.trim().is_empty())
}

/// The date (UTC, `YYYY-MM-DD`) and the RFC 3339 timestamp a list price read from
/// OpenRouter right now is written with.
fn list_price_stamp() -> Result<(String, String)> {
    let now = OffsetDateTime::now_utc();
    let as_of = now
        .date()
        .format(&time::macros::format_description!("[year]-[month]-[day]"))?;
    Ok((as_of, now.format(&Rfc3339)?))
}

/// The write of `rate` onto the entry `slug` as a list price read from OpenRouter.
fn list_price_write(slug: &str, rate: ListRate, as_of: String, now: String) -> ListPriceWrite {
    ListPriceWrite {
        slug: slug.to_string(),
        uncached_input: rate.uncached_input,
        cached_input: rate.cached_input,
        output: rate.output,
        as_of,
        source: LIST_PRICE_SOURCE_OPENROUTER.to_string(),
        now,
    }
}

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
            // The seed sets no provider policy: every figure comes from the listing until an
            // operator sets one on the model's form.
            quantization_filter: true,
            native_quantization: None,
            max_input_price: None,
            max_output_price: None,
            banned_providers: Vec::new(),
            unknown_quantization_providers: Vec::new(),
            // A seed carries no list price: the refresh that follows a start reads
            // one from OpenRouter.
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
            // Cases outer and the account's limit: what the legacy `review_plan` had. A
            // migrated plan is not filling; its owner fills it from the console.
            outer_axis: crate::api::CoverageAxis::Case,
            in_flight_limit: None,
            retry_count: crate::api::default_retry_count(),
            updated_at: now.clone(),
        };
        db.insert_coverage_plan(&plan.user_id, &coverage).await?;
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

/// Observe a run's model when the run completes: read its catalog facts from
/// OpenRouter and append them to its history if any changed. Keyed by the run's
/// canonical model id; a curated model is looked up under its configured OpenRouter
/// slug. No price is read: the run stays scored at the list price stamped at enqueue.
/// Best-effort — errors are logged and dropped so completion is never delayed or
/// failed.
pub async fn observe_completion(
    db: &Db,
    prices: &OpenRouterPrices,
    model_id: &str,
    harness: HarnessSlug,
) {
    if let Err(err) = try_observe_completion(db, prices, model_id, harness).await {
        tracing::warn!(model_id, error = %err, "could not record a model's catalog facts on run completion");
    }
}

/// The id to ask OpenRouter about for a run's model: a **curated** model's configured
/// OpenRouter slug when the run's canonical id is one of its aliases, else the canonical
/// id mapped onto OpenRouter's spelling.
///
/// The single spelling of this rule, shared by everything that reaches OpenRouter about one
/// model's catalog facts — the completion-time observation, the periodic refresh, and the
/// launch-time context-window fill — so all three ask about the same model.
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
        // unlisted model) simply records no observation.
        Err(_) => return Ok(()),
    };
    let details = with_developer_provider(db, prices, &canonical, &lookup, &details).await?;
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
    insert_if_changed(db, &canonical, &details, &now).await?;
    Ok(())
}

/// Record a first observation for every model in `targets` the catalog holds none
/// for, so a model's catalog facts are on record **before** anything needs them — the
/// Models page, the public snapshot, and a launch's context window — rather than only
/// once a run using it completes.
///
/// Seeding is deliberately *missing-only*: a model already on record is left to the
/// completion-time observation and the periodic refresh. That also makes the steady
/// state free — nothing is fetched when every target is already on record, so this costs
/// a network round trip exactly on the first sighting of a new model. A model on record
/// with no [developer provider](ModelDetails::provider_pin) counts as missing, so the
/// developer provider is observed as soon as the catalog meets a model rather than on the
/// next refresh.
///
/// `targets` maps the storage key an observation is filed under to the OpenRouter id
/// to ask about. Returns how many models were seeded; a catalog fetch that fails
/// seeds nothing rather than failing the caller.
async fn seed_missing_facts(
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
            tracing::warn!(error = %err, "catalog fact seeding: could not fetch OpenRouter catalog");
            return Ok(0);
        }
    };
    let now = OffsetDateTime::now_utc().format(&Rfc3339)?;
    let mut seeded = 0usize;
    for (storage_key, lookup) in missing {
        // A model OpenRouter does not list (a provider-native id, an unlisted model)
        // simply stays unobserved, exactly as at completion time.
        let Some(details) = catalog.get(&lookup) else {
            continue;
        };
        let details = with_developer_provider(db, prices, &storage_key, &lookup, details).await?;
        if insert_if_changed(db, &storage_key, &details, &now).await? {
            seeded += 1;
        }
    }
    Ok(seeded)
}

/// Seed the catalog facts of every model a launch binds, keyed by canonical id
/// exactly as the completion-time observation is. Called at enqueue so the catalog
/// knows a run's model from the moment the run exists, and the console's Models page
/// does not have to wait for the run to finish. No price is read here: the run's
/// comparable cost is priced at the list price stamped at enqueue.
///
/// It runs *before* the launch resolves its context window (`resolve_gg_model_facts`),
/// so a gg run against a never-before-seen model usually finds the window already in
/// the catalog rather than paying for a second, per-model fetch.
///
/// Best-effort: a failure is logged and dropped, never blocking a launch.
pub async fn seed_launch_facts(
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
    match seed_missing_facts(db, prices, targets).await {
        Ok(seeded) if seeded > 0 => {
            tracing::info!(seeded, "seeded model catalog facts for a launch");
        }
        Ok(_) => {}
        Err(err) => tracing::warn!(error = %err, "could not seed a launch's model catalog facts"),
    }
}

/// Seed a just-configured curated model's catalog facts from its OpenRouter slug, so
/// a model added or re-pointed in the app shows its context window, release date and
/// developer provider at once instead of `—` until its first run completes. Filed
/// under the slug — the key the periodic refresh uses — so the observation merges
/// with the model's other alias histories at compose time. The entry's list price is
/// untouched here.
///
/// Best-effort: a failure is logged and dropped, so saving a model config never fails
/// on OpenRouter being unreachable.
pub async fn seed_curated_facts(db: &Db, prices: &OpenRouterPrices, openrouter_slug: &str) {
    let targets = HashMap::from([(openrouter_slug.to_string(), openrouter_slug.to_string())]);
    match seed_missing_facts(db, prices, targets).await {
        Ok(seeded) if seeded > 0 => {
            tracing::info!(
                slug = openrouter_slug,
                "seeded catalog facts for a curated model"
            );
        }
        Ok(_) => {}
        Err(err) => {
            tracing::warn!(slug = openrouter_slug, error = %err, "could not seed a curated model's catalog facts");
        }
    }
}

/// Seed a first observation of the catalog facts of every model the catalog knows
/// but holds none for: each curated model's configured OpenRouter slug, and each model
/// a stored run references. Run at startup, so a freshly seeded deployment (curated
/// configs inserted by [`seed_models_if_empty`], an empty `model_price` table) knows
/// its models' context windows before its first run rather than after its first run
/// *completes*.
///
/// Missing-only via `seed_missing_facts`: the steady-state boot reads the
/// database and fetches nothing. Returns how many models were seeded.
pub async fn seed_catalog_facts(db: &Db, prices: &OpenRouterPrices) -> Result<usize> {
    // (storage key) -> OpenRouter lookup id — the same keying `refresh_all_facts`
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
    seed_missing_facts(db, prices, targets).await
}

/// Re-observe the catalog facts of every known model: each curated model against its
/// configured slug, and each model a run references against its canonical lookup id. The
/// context window, release date and modalities come from a single OpenRouter catalog
/// fetch and the developer provider from each model's endpoints listing. Appends an
/// observation only where a fact changed. No price is read: the list prices are
/// refreshed by [`refresh_list_prices`]. Returns how many models got a new observation.
pub async fn refresh_all_facts(db: &Db, prices: &OpenRouterPrices) -> Result<usize> {
    let catalog = match prices.all_model_details().await {
        Ok(catalog) => catalog,
        Err(err) => {
            tracing::warn!(error = %err, "periodic catalog fact refresh: could not fetch OpenRouter catalog");
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
        let details = with_developer_provider(db, prices, &storage_key, &lookup, details).await?;
        if insert_if_changed(db, &storage_key, &details, &now).await? {
            changed += 1;
        }
    }
    Ok(changed)
}

/// `details` with its [developer provider](ModelDetails::provider_pin) read from
/// `lookup`'s endpoints listing, which the models listing `details` came from does not
/// carry.
///
/// A listing that cannot be read keeps the provider last recorded under `storage_key`,
/// so an unreachable endpoint never records a model as having lost its developer
/// provider.
async fn with_developer_provider(
    db: &Db,
    prices: &OpenRouterPrices,
    storage_key: &str,
    lookup: &str,
    details: &ModelDetails,
) -> Result<ModelDetails> {
    let provider_pin = match prices.model_launch_facts(lookup).await {
        Ok(facts) => facts.provider_pin,
        Err(err) => {
            tracing::debug!(lookup, error = %err, "could not read a model's endpoints listing");
            db.latest_price(storage_key)
                .await?
                .and_then(|row| row.provider_pin)
        }
    };
    Ok(ModelDetails {
        provider_pin,
        ..details.clone()
    })
}

/// How long after it is spawned the periodic refresher first refreshes the list
/// prices: long enough for the server to be serving, short enough that a fresh
/// deployment shows current prices at once.
const STARTUP_REFRESH_DELAY: Duration = Duration::from_secs(5);

/// Spawn the periodic refresher, returning its task handle (kept alive for the
/// server's lifetime).
///
/// Shortly after it is spawned it [refreshes every list price](refresh_list_prices)
/// once, so a deployment is fresh without waiting a day and without its start waiting
/// on OpenRouter. Then, every 24 hours, it re-observes every known model's catalog
/// facts and refreshes every list price again. `on_change` is called whenever a
/// refresh changed a list price, one that failed part-way included: the public snapshot
/// shows the catalog. A failure is logged and retried on the next tick. Every read of
/// OpenRouter is bounded by its
/// [read timeout](test_cabinet_core::pricing::READ_TIMEOUT), so a connection that
/// stalls delays a tick and never stops the ones after it.
pub fn spawn_price_refresher(
    db: Arc<Db>,
    prices: OpenRouterPrices,
    on_change: impl Fn() + Send + Sync + 'static,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        tokio::time::sleep(STARTUP_REFRESH_DELAY).await;
        refresh_list_prices_logged(&db, &prices, &on_change, "startup").await;
        loop {
            tokio::time::sleep(REFRESH_INTERVAL).await;
            match refresh_all_facts(&db, &prices).await {
                Ok(changed) if changed > 0 => {
                    tracing::info!(
                        changed,
                        "periodic catalog fact refresh recorded new observations"
                    );
                }
                Ok(_) => {}
                Err(err) => tracing::warn!(error = %err, "periodic catalog fact refresh failed"),
            }
            refresh_list_prices_logged(&db, &prices, &on_change, "periodic").await;
        }
    })
}

/// One background [list price refresh](refresh_list_prices): log what it did. The
/// refresh itself calls `on_change` when a rate changed, however it ended.
async fn refresh_list_prices_logged(
    db: &Db,
    prices: &OpenRouterPrices,
    on_change: &(dyn Fn() + Sync),
    trigger: &'static str,
) {
    match refresh_list_prices(db, prices, on_change).await {
        Ok(refresh) => {
            tracing::info!(
                trigger,
                total = refresh.total,
                updated = refresh.updated,
                unchanged = refresh.unchanged,
                unresolved = refresh.unresolved,
                "refreshed list prices from OpenRouter"
            );
        }
        Err(err) => tracing::warn!(trigger, error = %err, "list price refresh failed"),
    }
}

/// Insert an observation of `model_id`'s catalog facts when one differs from the
/// latest on record (or there is none). Returns whether a row was inserted.
///
/// The facts are the context window, the release date, the accepted input
/// modalities and the developer provider. Any of them can change on its own (a
/// provider adds a longer route; a model gains vision), and a fact nothing ever
/// records is a fact gg cannot be told at launch.
async fn insert_if_changed(
    db: &Db,
    model_id: &str,
    details: &ModelDetails,
    now: &str,
) -> Result<bool> {
    let context_length = details.context_length.and_then(|c| i64::try_from(c).ok());
    let input_modalities = encode_modalities(&details.input_modalities);
    let provider_pin = details
        .provider_pin
        .clone()
        .filter(|provider| !provider.trim().is_empty());
    let changed = match db.latest_price(model_id).await? {
        Some(latest) => {
            latest.context_length != context_length
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

#[path = "bootstrap.list_price_refresh.rs"]
mod list_price_refresh;
pub use list_price_refresh::{ListPriceRefresh, refresh_list_prices};

#[cfg(test)]
#[path = "bootstrap.test.rs"]
mod tests;
