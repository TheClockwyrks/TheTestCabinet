// A tiny deterministic PRNG (mulberry32), ported verbatim from the TS `rng.ts`. Terrain
// generation and vehicle spawns are seeded so a city plays out the same way from the same
// seed — reproducible for the proof captures and the balance harness — while still varying
// seed to seed. The wrapping u32 arithmetic matches the JS `>>> 0` / `Math.imul` sequence
// exactly, so the same seed yields the same stream in the browser and native tests.
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Rng {
        Rng { state: seed }
    }

    pub fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }

    pub fn range(&mut self, min: f64, max: f64) -> f64 {
        min + (max - min) * self.next()
    }

    pub fn bool(&mut self, p_true: f64) -> bool {
        self.next() < p_true
    }
}
