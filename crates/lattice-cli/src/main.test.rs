//! Tests for the CLI's argument-parsing helpers (the host/oracle paths are
//! covered in `lattice-host`; here we only test the pure helpers this binary
//! adds).

use super::{group_thousands, parse_grid, parse_seed};

#[test]
fn parse_seed_accepts_decimal_and_hex() {
    assert_eq!(parse_seed("64199").unwrap(), 64199);
    assert_eq!(parse_seed("0xFAC7").unwrap(), 0xFAC7);
    assert_eq!(parse_seed("0XFAC7").unwrap(), 0xFAC7);
    // Whitespace is tolerated.
    assert_eq!(parse_seed("  0x10  ").unwrap(), 16);
    assert!(parse_seed("not-a-seed").is_err());
}

#[test]
fn parse_grid_reads_wxh() {
    assert_eq!(parse_grid("64x64").unwrap(), (64, 64));
    assert_eq!(parse_grid("96X48").unwrap(), (96, 48));
    assert!(parse_grid("64").is_err(), "missing the separator");
    assert!(
        parse_grid("0x8").is_err(),
        "a non-positive dimension is rejected"
    );
    assert!(parse_grid("axb").is_err(), "non-integers are rejected");
}

#[test]
fn group_thousands_formats_fuel_readably() {
    assert_eq!(group_thousands(0), "0");
    assert_eq!(group_thousands(42), "42");
    assert_eq!(group_thousands(1_000), "1,000");
    assert_eq!(group_thousands(12_345_678), "12,345,678");
    assert_eq!(group_thousands(1_000_000_000), "1,000,000,000");
}
