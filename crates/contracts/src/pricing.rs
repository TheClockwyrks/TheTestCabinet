//! Provider identity: the one rule for whether two spellings name the same
//! OpenRouter provider.
//!
//! The price lookup itself (the OpenRouter client, the price tables, the cost
//! computation) is runtime and lives in `test_cabinet_core::pricing`, which
//! re-exports these.

/// Whether `a` and `b` name the same OpenRouter provider.
///
/// OpenRouter spells one provider several ways: `Z.AI` in the endpoints listing and on a
/// response, `z-ai` in the model id and the route tag, and it accepts either in a request's
/// `provider` object. Two spellings agree when they are equal after lowercasing and dropping
/// everything but letters and digits. A blank spelling agrees with nothing.
pub fn same_provider(a: &str, b: &str) -> bool {
    let a = provider_key(a);
    !a.is_empty() && a == provider_key(b)
}

/// A provider spelling reduced to the characters [`same_provider`] compares.
pub fn provider_key(name: &str) -> String {
    name.chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
