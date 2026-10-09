//! **TCQ**'s runtime half: the [document builder](build_run_doc) that flattens a run
//! into the [`GgRunDoc`] a query runs over, and the [evaluator](evaluate) that runs a
//! compiled [`GgQuery`] over a corpus of them.
//!
//! The query language itself (its shapes, and the semantic and determinism rules both
//! implementations of the evaluator hold to) is
//! [`test_cabinet_contracts::gg_query`], whose types this module re-exports, so
//! `test_cabinet_core::gg_query::GgQuery` and the rest name the same items they
//! always did. The checked-in conformance fixture,
//! `crates/contracts/fixtures/gg_query.conformance.json`, is executed by this module's
//! tests and by the TypeScript evaluator's.

pub use test_cabinet_contracts::gg_query::*;

#[path = "gg_query.doc.rs"]
mod doc;

#[path = "gg_query.eval.rs"]
mod eval;

pub use doc::{
    GG_CAPABILITY_CATALOG, GG_DATE_FIELDS, GG_PRIVATE_FIELDS, GG_PUBLIC_MAX_STRING, GgDocLifecycle,
    build_run_doc, flatten_json, redacted_for_public,
};
pub use eval::{evaluate, field_catalog};

#[cfg(test)]
#[path = "gg_query.test.rs"]
mod tests;
