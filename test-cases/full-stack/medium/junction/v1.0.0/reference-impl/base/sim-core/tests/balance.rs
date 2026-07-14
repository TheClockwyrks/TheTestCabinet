// Junction — the native balance harness (DESIGN §7, specs/simulation.md).
//
// The Rust core compiles natively as well as to wasm, so the balance goals are asserted with
// plain `cargo test` — no browser, no wasm. Each test drives the real `Game` with a scripted
// "player" strategy (the same build the proof capture uses) and checks the economy behaves:
// a competent build-out grows and stays solvent; an over-builder slides toward bankruptcy; a
// neglecter goes insolvent; cutting a utility abandons the tiles that depended on it; and the
// whole simulation is deterministic. Tuning is a one-line edit in `constants.rs` re-checked
// by re-running this file.

use junction_sim_core::game::Game;
use junction_sim_core::types::{GameState, ZoneKind};
use junction_sim_core::world::{idx, T_WATER};

const SEED: u32 = 0x4a55_4e43;

/// The scripted city, ported verbatim from the proof capture (`scripts/proof.mjs`): a wired
/// R/C/I core block, a riverside residential pocket, three power plants, river-fed water
/// sources, and a rail line with stations. `treasury` stages the starting balance.
fn build_city(g: &mut Game, treasury: f64) {
    g.new_city(SEED);
    g.budget.treasury = treasury;

    let (bc0, bc1, top, bot) = (32, 66, 30, 44);
    // Even-row road+wire+pipe service corridors across the core block.
    let mut r = top;
    while r <= bot {
        g.road(bc0, r, bc1, r);
        g.wire(bc0, r, bc1, r);
        g.pipe(bc0, r, bc1, r);
        r += 2;
    }
    // Vertical connectors every 6 cols so traffic spreads and utilities reach every lot.
    let mut c = bc0;
    while c <= bc1 {
        g.road(c, top, c, bot);
        g.wire(c, top, c, bot);
        g.pipe(c, top, c, bot);
        c += 6;
    }
    // The three zones, painted as rectangles over the wired block (odd rows develop).
    g.zone_rect(ZoneKind::Res, 32, 30, 42, 44);
    g.zone_rect(ZoneKind::Com, 44, 30, 54, 44);
    g.zone_rect(ZoneKind::Ind, 56, 30, 66, 44);

    // A riverside RES pocket hugging the river — the water amenity lifts land value.
    let (pc0, pc1, ptop, pbot) = (44, 52, 16, 22);
    let mut r = ptop;
    while r <= pbot {
        g.road(pc0, r, pc1, r);
        g.wire(pc0, r, pc1, r);
        g.pipe(pc0, r, pc1, r);
        r += 2;
    }
    g.road(pc0, ptop, pc0, pbot);
    g.wire(pc0, ptop, pc0, pbot);
    g.pipe(pc0, ptop, pc0, pbot);
    g.zone_rect(ZoneKind::Res, pc0, ptop, pc1, pbot);
    g.road(44, pbot, 44, top);
    g.wire(44, pbot, 44, top);
    g.pipe(44, pbot, 44, top);

    // Power: three plants adjacent to the core wire net (2×2 to the west of col 32).
    g.plant(30, 30);
    g.plant(30, 38);
    g.plant(30, 44);

    // Water: sources placed beside the river with a pipe trunk down into the core net.
    for target_col in [34, 40, 62] {
        for row in 6..=28 {
            if g.world.terrain[idx(target_col, row)] == T_WATER {
                let anchor = row + 1;
                if g.source(target_col, anchor).placed > 0 {
                    g.pipe(target_col, anchor + 2, target_col, top);
                    break;
                }
            }
        }
    }

    // A rail line below the core with stations that touch the core road.
    g.rail(38, 45, 62, 45);
    for c in [38, 44, 50, 56, 62] {
        g.station(c, 45);
    }
}

/// Count developed tiles and their tiers/services across the whole map.
fn survey(g: &Game) -> (u32, u32, u32, u32, u32) {
    let w = &g.world;
    let (mut developed, mut tier2, mut powered, mut watered, mut ind) = (0, 0, 0, 0, 0);
    for i in 0..w.tier.len() {
        if w.zone[i] != 0 && w.tier[i] > 0 {
            developed += 1;
            if w.tier[i] >= 2 {
                tier2 += 1;
            }
            if w.powered[i] != 0 {
                powered += 1;
            }
            if w.watered[i] != 0 {
                watered += 1;
            }
            if w.zone[i] == 3 {
                ind += 1;
            }
        }
    }
    (developed, tier2, powered, watered, ind)
}

#[test]
fn competent_build_grows_and_stays_solvent() {
    let mut g = Game::new();
    build_city(&mut g, 140_000.0);
    g.advance(24.0);

    let (developed, tier2, powered, watered, _ind) = survey(&g);
    assert!(developed > 40, "expected a developed city, got {developed} developed tiles");
    assert!(tier2 > 0, "expected tiles to climb past tier 1, got {tier2} at tier ≥2");
    assert!(powered > 0 && watered > 0, "developed tiles must be served (P {powered} / W {watered})");
    assert!(g.stats.peak_population > 200.0, "expected growth, peak = {}", g.stats.peak_population);
    assert!(g.vehicles.len() > 0, "expected vehicles pathing the network");
    assert!(g.world.pollution.iter().any(|&p| p > 0.5), "industry should emit pollution");

    // Stay solvent for many months: a funded, developed city keeps running well past the
    // point where an over-builder with no tax base is already bankrupt (see the over-builder
    // test). Perpetual solvency is NOT a given — the economy is deliberately tuned so an
    // over-wired city loses money each period (the manifest's core tension), and holding a
    // surplus indefinitely means pushing land value to the high density tiers — so this
    // asserts a long viable window, not that the treasury never falls.
    g.advance(24.0); // month ~48 total
    assert_eq!(g.state, GameState::Playing, "a competent, funded city must stay solvent for many months");
    assert!(g.budget.treasury > 0.0, "expected a positive treasury through the viable window: {}", g.budget.treasury);
}

#[test]
fn overbuilder_slides_toward_bankruptcy() {
    // Lay a large, upkeep-heavy network far ahead of any tax base (nothing zoned → no income)
    // on a modest treasury; the monthly balance is deeply negative and the treasury falls.
    let mut g = Game::new();
    g.new_city(SEED);
    g.budget.treasury = 30_000.0;
    for r in (28..=60).step_by(2) {
        g.road(20, r, 80, r);
        g.wire(20, r, 80, r);
        g.pipe(20, r, 80, r);
    }
    g.rail(20, 62, 80, 62);
    for c in (24..=76).step_by(6) {
        g.station(c, 62);
    }
    g.plant(30, 64);
    g.plant(40, 64);

    g.advance(200.0);
    assert_eq!(g.state, GameState::Bankrupt, "an over-builder with no tax base must go bankrupt");
}

#[test]
fn neglecter_goes_insolvent() {
    // A working city whose owner strips income (tax → 0) and stops growing: upkeep drains the
    // treasury past the debt limit — the deliberate slide the crisis clip captures.
    let mut g = Game::new();
    build_city(&mut g, 6_000.0);
    g.advance(16.0); // grow a real, populated city first
    g.force_bankruptcy(); // tax → 0, income dries up
    g.advance(120.0);
    assert_eq!(g.state, GameState::Bankrupt, "a neglected, income-stripped city must go insolvent");
}

#[test]
fn cutting_a_utility_abandons_dependents() {
    let mut g = Game::new();
    build_city(&mut g, 140_000.0);
    g.advance(24.0);
    let (developed_before, _, _, _, _) = survey(&g);
    assert!(developed_before > 40);

    // Raze the three power plants (their 2×2 footprints sit west of the core at col 30).
    g.bulldoze_rect(30, 30, 31, 31);
    g.bulldoze_rect(30, 38, 31, 39);
    g.bulldoze_rect(30, 44, 31, 45);
    // With no power, the served precondition is lost — tiles dilapidate and abandon.
    g.advance(60.0);
    let (developed_after, _, powered_after, _, _) = survey(&g);
    assert_eq!(powered_after, 0, "no plant should mean no powered tiles, got {powered_after}");
    assert!(
        developed_after < developed_before,
        "cutting power must abandon dependents: {developed_before} → {developed_after}"
    );
}

#[test]
fn deterministic_month_by_month() {
    let mut a = Game::new();
    let mut b = Game::new();
    build_city(&mut a, 140_000.0);
    build_city(&mut b, 140_000.0);
    for month in 0..40 {
        a.advance(1.0);
        b.advance(1.0);
        let (sa, sb) = (a.snapshot(), b.snapshot());
        assert_eq!(sa.population, sb.population, "population diverged at month {month}");
        assert_eq!(sa.treasury, sb.treasury, "treasury diverged at month {month}");
        assert_eq!(a.vehicles.len(), b.vehicles.len(), "vehicle count diverged at month {month}");
    }
}

