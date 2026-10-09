//! The one-time rewrite of stored list prices to the standard endpoint's rate.
//!
//! A catalog filled before Flex endpoints were ignored can hold a developer
//! provider's discounted Flex rate as a list price, and a stored list price is
//! never read again from OpenRouter. [`rewrite_list_prices`] reads the standard
//! rate of every entry that carries a list price and writes it over the stored one,
//! once per database.

use super::*;

/// What a [`rewrite_list_prices`] call did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListPriceRewrite {
    /// The database already records the rewrite as complete. Nothing was fetched.
    AlreadyComplete,
    /// OpenRouter could not be read for the catalog, or for `unread` of the entries.
    /// Nothing was written, and the next start tries again.
    Deferred {
        /// The entries whose endpoints listing could not be read. Zero when the
        /// catalog itself could not be.
        unread: usize,
    },
    /// Every entry was read, `rewritten` of them held a different rate and now hold
    /// the standard one, and the database records the rewrite as complete.
    Complete {
        /// The entries whose list price changed.
        rewritten: usize,
    },
}

/// Overwrite the list price of every curated entry that carries one with the rate of
/// its official provider's standard endpoint, as OpenRouter lists it now.
///
/// The rate is [`ModelLaunchFacts::official_prices`](test_cabinet_core::ModelLaunchFacts::official_prices):
/// the route of the entry's hand-set developer provider, else of the observed one, with
/// Flex endpoints left out. An entry is left as it is when it carries no list price, has
/// no OpenRouter slug, is not in OpenRouter's catalog, or has no official endpoint with
/// all three rates. An entry already at the standard rate is not written, so it keeps its
/// date and source; one that changes is dated today and sourced
/// [`LIST_PRICE_SOURCE_OPENROUTER`], whoever entered the figure it replaces. Runs are not
/// touched.
///
/// The rewrite happens at most once per database. Every rate is read before any is
/// written: if a listing cannot be read the call writes nothing and returns
/// [`ListPriceRewrite::Deferred`], and otherwise it writes them all and records itself
/// complete, after which every call returns [`ListPriceRewrite::AlreadyComplete`] without
/// reaching OpenRouter.
pub async fn rewrite_list_prices(db: &Db, prices: &OpenRouterPrices) -> Result<ListPriceRewrite> {
    if db.list_price_rewrite_completed().await? {
        return Ok(ListPriceRewrite::AlreadyComplete);
    }
    let priced: Vec<_> = db
        .list_model_configs()
        .await?
        .into_iter()
        .filter(|stored| {
            stored.config.list_price_input.is_some()
                && stored.config.list_price_cached_input.is_some()
                && stored.config.list_price_output.is_some()
        })
        .collect();
    if priced.is_empty() {
        // Nothing to rewrite, and nothing filled from now on reads a Flex endpoint.
        db.mark_list_price_rewrite_complete().await?;
        return Ok(ListPriceRewrite::Complete { rewritten: 0 });
    }
    let catalog = match prices.all_model_details().await {
        Ok(catalog) => catalog,
        Err(err) => {
            tracing::warn!(error = %err, "list price rewrite: could not fetch OpenRouter catalog");
            return Ok(ListPriceRewrite::Deferred { unread: 0 });
        }
    };

    let mut unread = 0usize;
    let mut writes: Vec<(String, [f64; 3])> = Vec::new();
    for stored in &priced {
        let config = &stored.config;
        let Some(slug) = config.openrouter_slug.as_deref() else {
            continue;
        };
        if !catalog.contains_key(slug) {
            continue;
        }
        let facts = match prices.model_launch_facts(slug).await {
            Ok(facts) => facts,
            Err(err) => {
                tracing::warn!(slug, error = %err, "list price rewrite: could not read a model's endpoints listing");
                unread += 1;
                continue;
            }
        };
        let hand_pin = config
            .provider_pin
            .as_deref()
            .filter(|provider| !provider.trim().is_empty());
        let Some(TokenPrices {
            uncached_input: Some(uncached_input),
            cached_input: Some(cached_input),
            output: Some(output),
        }) = facts.official_prices(hand_pin)
        else {
            continue;
        };
        let standard = [uncached_input, cached_input, output];
        let held = [
            config.list_price_input,
            config.list_price_cached_input,
            config.list_price_output,
        ];
        if held != standard.map(Some) {
            writes.push((config.slug.clone(), standard));
        }
    }
    if unread > 0 {
        return Ok(ListPriceRewrite::Deferred { unread });
    }

    let now = OffsetDateTime::now_utc();
    let as_of = now
        .date()
        .format(&time::macros::format_description!("[year]-[month]-[day]"))?;
    let stamp = now.format(&Rfc3339)?;
    let rewritten = writes.len();
    for (slug, [uncached_input, cached_input, output]) in writes {
        tracing::info!(
            slug,
            uncached_input,
            cached_input,
            output,
            "rewrote a list price to the standard endpoint's rate"
        );
        db.set_list_price(ListPriceWrite {
            slug,
            uncached_input,
            cached_input,
            output,
            as_of: as_of.clone(),
            source: LIST_PRICE_SOURCE_OPENROUTER.to_string(),
            now: stamp.clone(),
        })
        .await?;
    }
    db.mark_list_price_rewrite_complete().await?;
    Ok(ListPriceRewrite::Complete { rewritten })
}

/// Run [`rewrite_list_prices`] once in the background, calling `on_change` when it
/// rewrote an entry (the public snapshot shows the catalog). One attempt per process:
/// a deferred or failed attempt is logged and left to the next start.
pub fn spawn_list_price_rewrite(
    db: Arc<Db>,
    prices: OpenRouterPrices,
    on_change: impl Fn() + Send + 'static,
) {
    tokio::spawn(async move {
        match rewrite_list_prices(&db, &prices).await {
            Ok(ListPriceRewrite::AlreadyComplete) => {}
            Ok(ListPriceRewrite::Complete { rewritten }) => {
                tracing::info!(
                    rewritten,
                    "rewrote stored list prices to standard endpoint rates"
                );
                if rewritten > 0 {
                    on_change();
                }
            }
            Ok(ListPriceRewrite::Deferred { unread }) => tracing::warn!(
                unread,
                "list price rewrite deferred to the next start: OpenRouter could not be read"
            ),
            Err(err) => tracing::warn!(error = %err, "list price rewrite failed"),
        }
    });
}

#[cfg(test)]
#[path = "bootstrap.list_price_rewrite.test.rs"]
mod tests;
