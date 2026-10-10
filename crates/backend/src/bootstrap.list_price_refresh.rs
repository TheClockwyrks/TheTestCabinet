//! The refresh of every catalog entry's list price from OpenRouter.
//!
//! [`refresh_list_prices`] is what keeps the catalog's list prices current: the
//! periodic refresher runs it shortly after startup and every 24 hours, and
//! `POST /models/list-prices/refresh` runs it on request.

use futures_util::StreamExt;

use test_cabinet_core::pricing::{ListPriceResolution, ModelsListingPrices};
use test_cabinet_core::run_record::HarnessFamily;

use super::*;
use crate::db::StoredModel;

/// How many entries' OpenRouter listings are read at once.
const READ_CONCURRENCY: usize = 8;

/// What a [`refresh_list_prices`] call did, counted in catalog entries.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ListPriceRefresh {
    /// Every curated entry: the sum of the other three.
    pub total: usize,
    /// The entries whose rate changed, or that had no list price and now have one.
    pub updated: usize,
    /// The entries whose stored rate OpenRouter confirmed. Their date and source
    /// were rewritten.
    pub unchanged: usize,
    /// The entries OpenRouter gave no rate for, which keep what they hold.
    pub unresolved: usize,
}

impl ListPriceRefresh {
    /// Whether any entry's rate changed. A refresh that returned its counts reported
    /// this through its `on_change` already.
    pub fn changed(&self) -> bool {
        self.updated > 0
    }
}

/// Calls `on_change` when it is dropped, if a rate was marked as changed.
///
/// A refresh writes its entries one by one, so it can stop with some written: on a
/// database failure, or when its future is dropped because the request that awaited it
/// went away. The catalog changed all the same, and the next refresh would find those
/// rates already stored and report no change. Reporting the change from `Drop` is what
/// makes every way a refresh can end report it.
struct ChangeReport<'a> {
    changed: bool,
    on_change: &'a (dyn Fn() + Sync),
}

impl Drop for ChangeReport<'_> {
    fn drop(&mut self) {
        if self.changed {
            (self.on_change)();
        }
    }
}

/// Read the list price of **every** curated catalog entry from OpenRouter and write it
/// onto the entry, dated today (UTC) and sourced [`LIST_PRICE_SOURCE_OPENROUTER`].
///
/// Every entry is read, whether or not it already carries a list price and whoever
/// entered it, so a price an operator typed stands only until the next refresh
/// resolves a rate for that model. The rate is resolved by the
/// [list-price flow](test_cabinet_core::ModelLaunchFacts::list_price) with the entry's
/// hand-set developer provider: that provider's standard rate while it publishes a
/// complete one, and never another provider's in its place. An entry neither that
/// provider nor the model id's author segment prices takes the model's own price in
/// OpenRouter's models listing (the `pricing` field of its `/models` entry).
///
/// The models listing is read at most once in a refresh, the first time an entry
/// reaches that last step, and every later entry that reaches it reuses the read. A
/// refresh no entry takes that far does not read it. When it cannot be read, the entries
/// that needed it are [unresolved](ListPriceRefresh::unresolved) and the entries the
/// endpoints listings answered are written as usual.
///
/// An entry is looked up by its OpenRouter slug. One without a slug is looked up by its
/// aliases, each mapped onto OpenRouter's spelling for a harness of the alias's family,
/// and the first alias OpenRouter lists decides.
///
/// An entry OpenRouter does not list, yields no complete rate for, or whose listing
/// cannot be read keeps what it holds and is counted
/// [unresolved](ListPriceRefresh::unresolved): a price entered by hand for a model that
/// is not on OpenRouter survives every refresh. A listing that has not answered within
/// the [read timeout](test_cabinet_core::pricing::READ_TIMEOUT) is one that cannot be
/// read, so a stalled connection costs the refresh that long and no longer. An entry
/// whose resolved rate equals the stored one is still written, so its date says how
/// fresh the figure is.
///
/// Runs are not touched: a run keeps the cost it was scored at.
///
/// The endpoints listings are read eight at a time, never all at once, and each entry is
/// written as its read finishes. `Err` is a database failure.
///
/// `on_change` is called once, as the refresh ends, when it changed any entry's rate:
/// the catalog changed, and the caller owns what follows from that (the public
/// snapshot's refresh). It is called however the refresh ends, a database failure and a
/// dropped future included, because the entries written before then stay written and no
/// later refresh would report them as changed.
pub async fn refresh_list_prices(
    db: &Db,
    prices: &OpenRouterPrices,
    on_change: &(dyn Fn() + Sync),
) -> Result<ListPriceRefresh> {
    let configs = db.list_model_configs().await?;
    let mut refresh = ListPriceRefresh {
        total: configs.len(),
        ..ListPriceRefresh::default()
    };
    let mut report = ChangeReport {
        changed: false,
        on_change,
    };
    // The one read of the models listing this refresh makes, if any entry needs it.
    let listing = ModelsListingPrices::new();
    let listing = &listing;
    let mut reads = futures_util::stream::iter(configs)
        .map(|stored| async move {
            let resolved = resolve_entry(prices, listing, &stored).await;
            (stored, resolved)
        })
        .buffer_unordered(READ_CONCURRENCY);
    let (as_of, now) = list_price_stamp()?;
    while let Some((stored, resolved)) = reads.next().await {
        let config = &stored.config;
        let Some(resolved) = resolved else {
            refresh.unresolved += 1;
            continue;
        };
        let rate = resolved.rate;
        let held = [
            config.list_price_input,
            config.list_price_cached_input,
            config.list_price_output,
        ];
        let rate_changes = held != [rate.uncached_input, rate.cached_input, rate.output].map(Some);
        // Marked before the write, not after it: a write cut short may still have landed.
        report.changed |= rate_changes;
        if let Err(err) = db
            .set_list_price(list_price_write(
                &config.slug,
                rate,
                as_of.clone(),
                now.clone(),
            ))
            .await
        {
            // An entry deleted while its listing was being read has nothing to keep
            // current. Any other failure is the database's.
            if db.get_model_config(&config.slug).await?.is_none() {
                refresh.unresolved += 1;
                continue;
            }
            return Err(err);
        }
        if rate_changes {
            refresh.updated += 1;
            tracing::info!(
                slug = config.slug,
                step = resolved.step.as_str(),
                provider = resolved.provider.as_deref(),
                uncached_input = rate.uncached_input,
                cached_input = rate.cached_input,
                output = rate.output,
                "list price changed on refresh"
            );
        } else {
            refresh.unchanged += 1;
        }
    }
    Ok(refresh)
}

/// The list price OpenRouter publishes for one entry, or `None` when it gives none:
/// the entry is not listed under any id it can be looked up by, a listing the
/// resolution needed could not be read, or the resolution yields no complete rate.
/// `listing` is the refresh's one read of the models listing.
async fn resolve_entry(
    prices: &OpenRouterPrices,
    listing: &ModelsListingPrices,
    stored: &StoredModel,
) -> Option<ListPriceResolution> {
    let hand_pin = hand_set_provider(&stored.config);
    for lookup in lookup_ids(stored) {
        match prices.list_price_sharing(&lookup, hand_pin, listing).await {
            // The first id OpenRouter lists decides, with or without a rate.
            Ok(resolved) => {
                if resolved.is_none() {
                    tracing::debug!(
                        slug = stored.config.slug,
                        lookup,
                        "list price refresh: OpenRouter lists no complete rate"
                    );
                }
                return resolved;
            }
            Err(err) => {
                tracing::debug!(
                    slug = stored.config.slug,
                    lookup,
                    error = %err,
                    "list price refresh: could not read a listing the model's price needs"
                );
            }
        }
    }
    None
}

/// The OpenRouter ids to look an entry up by, in the order to try them: its OpenRouter
/// slug alone when it has one, else each alias mapped onto OpenRouter's spelling.
fn lookup_ids(stored: &StoredModel) -> Vec<String> {
    if let Some(slug) = stored
        .config
        .openrouter_slug
        .as_deref()
        .map(str::trim)
        .filter(|slug| !slug.is_empty())
    {
        return vec![slug.to_string()];
    }
    let mut ids: Vec<String> = Vec::new();
    for alias in &stored.aliases {
        let id = openrouter_price_id(&alias.alias, family_harness(alias.family));
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

/// A harness of `family`, for mapping one of the family's model ids onto OpenRouter's
/// spelling. Every harness of a family spells its ids the same way.
fn family_harness(family: HarnessFamily) -> HarnessSlug {
    match family {
        HarnessFamily::Claude => HarnessSlug::Claude,
        HarnessFamily::Codex => HarnessSlug::Codex,
        HarnessFamily::Antigravity => HarnessSlug::Antigravity,
        HarnessFamily::Openrouter => HarnessSlug::Gg,
    }
}

#[cfg(test)]
#[path = "bootstrap.list_price_refresh.test.rs"]
mod tests;
