use super::*;

#[test]
fn same_seed_reproduces_stream() {
    let mut a = Prng::new(0x1234);
    let mut b = Prng::new(0x1234);
    for _ in 0..64 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
}

#[test]
fn different_seed_diverges() {
    let mut a = Prng::new(1);
    let mut b = Prng::new(2);
    // Extremely unlikely to match on the first draw.
    assert_ne!(a.next_u64(), b.next_u64());
}

#[test]
fn bipolar_in_range() {
    let mut rng = Prng::new(99);
    for _ in 0..10_000 {
        let v = rng.next_bipolar();
        assert!((-1.0..1.0).contains(&v), "out of range: {v}");
    }
}

#[test]
fn derived_seeds_are_distinct_per_index() {
    let a = derive_seed(0xABCD, 0);
    let b = derive_seed(0xABCD, 1);
    let c = derive_seed(0xABCD, 2);
    assert_ne!(a, b);
    assert_ne!(b, c);
    assert_ne!(a, c);
    // Deterministic: the same (seed, index) always derives the same value.
    assert_eq!(a, derive_seed(0xABCD, 0));
}
