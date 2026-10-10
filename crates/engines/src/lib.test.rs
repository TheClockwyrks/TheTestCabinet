//! Tests for the built-in manifest table.

use super::*;

#[test]
fn the_table_lists_the_built_in_slugs_in_catalogue_order() {
    // The catalog enumerates the table in its own order, and every listing of
    // the engines (`tcab engines`, the console's picker) follows it, so the table
    // and the contract's slug list are one sequence.
    let slugs: Vec<&str> = BUILT_IN.iter().map(|(slug, _)| *slug).collect();
    assert_eq!(slugs, test_cabinet_contracts::engine::BUILT_IN_SLUGS);
}
