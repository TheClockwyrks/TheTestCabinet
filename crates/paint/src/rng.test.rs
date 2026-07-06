use super::*;

#[test]
fn is_deterministic_for_a_seed() {
    let mut a = Rng::new(42);
    let mut b = Rng::new(42);
    for _ in 0..100 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
}

#[test]
fn different_seeds_diverge() {
    let mut a = Rng::new(1);
    let mut b = Rng::new(2);
    assert_ne!(a.next_u64(), b.next_u64());
}

#[test]
fn f32_stays_in_unit_interval() {
    let mut rng = Rng::new(7);
    for _ in 0..1000 {
        let v = rng.next_f32();
        assert!((0.0..1.0).contains(&v), "{v} out of range");
    }
}

#[test]
fn derived_seeds_are_stable_and_index_dependent() {
    assert_eq!(derive_seed(99, 0), derive_seed(99, 0));
    assert_ne!(derive_seed(99, 0), derive_seed(99, 1));
}
