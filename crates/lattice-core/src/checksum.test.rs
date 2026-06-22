//! Tests for the FNV-1a 64 checksum and its string format.

use super::*;

#[test]
fn fnv1a64_matches_the_known_reference_vectors() {
    // Canonical FNV-1a 64 test vectors (the published reference values).
    assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
    assert_eq!(fnv1a64(b"foobar"), 0x8594_4171_f739_67e8);
}

#[test]
fn checksum_string_is_lowercase_hex_with_the_prefix() {
    let s = checksum_string(b"");
    assert_eq!(s, "fnv1a64:cbf29ce484222325");
    assert!(s.starts_with("fnv1a64:"));
    // Exactly 16 hex digits after the prefix.
    assert_eq!(s.len(), "fnv1a64:".len() + 16);
}
