//! The FNV-1a 64-bit checksum used as the correctness key.
//!
//! A snapshot's correctness is compared by hashing its
//! [canonical bytes](crate::state::canonical_bytes) — never the JSON text — so
//! JSON formatting differences can never affect correctness. This is precisely
//! Factorio's own desync-detection model: each engine checksums its state and a
//! mismatch means a simulation diverged.
//!
//! FNV-1a is chosen for being trivially specifiable in any language (a model
//! writing a non-Rust submission must reproduce it bit-for-bit from the spec),
//! fast, and dependency-free.

/// The FNV-1a 64-bit offset basis.
const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
/// The FNV-1a 64-bit prime.
const PRIME: u64 = 0x0000_0100_0000_01b3;

/// Hash `bytes` with FNV-1a 64. Each byte is XORed into the accumulator, then the
/// accumulator is multiplied by the prime (wrapping). This is the whole
/// algorithm — there is nothing language-specific about it.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = OFFSET_BASIS;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// Format a byte buffer's FNV-1a 64 hash as the canonical checksum string,
/// `"fnv1a64:%016x"` — exactly 16 lowercase hex digits with the `fnv1a64:`
/// prefix (e.g. `fnv1a64:9f3c1a77b2e40118`). This string is the value the
/// validator compares.
pub fn checksum_string(bytes: &[u8]) -> String {
    format!("fnv1a64:{:016x}", fnv1a64(bytes))
}

#[cfg(test)]
#[path = "checksum.test.rs"]
mod tests;
