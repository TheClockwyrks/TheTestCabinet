// Junction — the Game: owns the world/economy state and the state machine, and orders the
// fixed simulation step (specs/flow.md, DESIGN §4, §5.2), ported from `sim.ts`.
//
// `fixed_step(dt)` is the whole tick, in the order DESIGN §4 fixes:
//   transit → utilities → develop → pollution/land → (monthly) RCI + budget settle → stats +
//   milestones. It is DOM-free and deterministic, driven identically by the browser loop and
//   the native balance harness / proof hook. The Game also exposes the player actions (tools,
//   tax, speed, overlay, pause), the state machine, the menu list + navigation index, the
//   notification/sound/fx queues the front end drains, and the scripted control surface
//   (`new_city`, `zone_rect`, `road`, `advance`, `snapshot`, `force_bankruptcy`, …) the front
//   end wires to `window.__junction`. The camera is a FRONT-END concern (specs/simulation.md),
//   so it lives in JS, not here: `new_city` never moves it, and a milestone's fireworks are
//   emitted for the front end to place at the current view centre.

use crate::constants::*;
use crate::economy::{compute_station_bonus, recompute_land, settle_budget, step_pollution, update_rci};
use crate::develop::step_development;
use crate::graph::rebuild_networks;
use crate::menus::menu_items;
use crate::mode::MODE;
use crate::rng::Rng;
use crate::tools::{apply_tool, tiles_for_drag};
use crate::transit::{rebuild_signals, step_transit};
use crate::types::*;
use crate::utilities::step_utilities;
use crate::world::{generate_valley, idx, World};
use std::collections::HashSet;

const NOTIFY_TTL: f64 = 6.0; // seconds a HUD toast lives
const MAX_NOTIFICATIONS: usize = 5;
const DISTRICT_MILESTONE: u32 = 8; // fully-served developed tiles that count as a "district"

pub struct Game {
    pub world: World,
    pub state: GameState,
    pub overlay: Overlay,
    pub active_tool: Option<Tool>,
    pub paused: bool, // in-place pause (specs/controls.md) — distinct from the paused STATE
    pub speed: u8,

    pub vehicles: Vec<Vehicle>,
    pub signals: Vec<Signal>,
    pub rci: Rci,
    pub budget: Budget,
    pub stats: GameStats,
    pub clock: Clock,

    pub notifications: Vec<Notification>,
    milestones_fired: HashSet<String>,

    pub hover_tile: i32,
    pub selected_tile: i32,

    // Queues drained by the front end each frame (the sim owns no audio/canvas).
    pub snd_queue: Vec<Cue>,
    pub fx_queue: Vec<FxEvent>,

    pub menu_index: usize, // highlighted item in the current state's menu (owned here)

    rng: Rng,
    next_vehicle_id: u32,
    tick_count: u32,

    // Derived flags refreshed by recompute_stats (drive the milestone checks cheaply).
    rail_tiles: u32,
    tier3_tiles: u32,
    served_district: u32,
}

impl Default for Game {
    fn default() -> Self {
        Game::new()
    }
}

impl Game {
    pub fn new() -> Game {
        let mut g = Game {
            world: generate_valley(MODE.seed), // a valley behind the title menu for atmosphere
            state: GameState::Title,
            overlay: Overlay::None,
            active_tool: None,
            paused: false,
            speed: 1,
            vehicles: Vec::new(),
            signals: Vec::new(),
            rci: Rci::default(),
            budget: Budget::default(),
            stats: GameStats::default(),
            clock: Clock {
                month: START_MONTH_MONTH,
                year: START_MONTH_YEAR,
            },
            notifications: Vec::new(),
            milestones_fired: HashSet::new(),
            hover_tile: -1,
            selected_tile: -1,
            snd_queue: Vec::new(),
            fx_queue: Vec::new(),
            menu_index: 0,
            rng: Rng::new(1),
            next_vehicle_id: 1,
            tick_count: 0,
            rail_tiles: 0,
            tier3_tiles: 0,
            served_district: 0,
        };
        g.mark_networks_dirty();
        g
    }

    // ---- Lifecycle / state machine ---------------------------------------------
    pub fn new_city(&mut self, seed: u32) {
        self.world = generate_valley(seed);
        self.rng = Rng::new(seed ^ 0x9e3779b9);

        // The short pre-placed starting road stub (mode owns the geometry).
        for k in 0..MODE.stub.len {
            let col = MODE.stub.col + k;
            let row = MODE.stub.row;
            if col >= 0 && col < MAP_COLS as i32 && row >= 0 && row < MAP_ROWS as i32 {
                self.world.set_net(idx(col, row), NET_ROAD);
            }
        }

        self.budget = Budget {
            treasury: MODE.start_treasury,
            income: 0.0,
            upkeep: 0.0,
            balance: 0.0,
            tax_rate: MODE.start_tax,
        };
        self.rci = MODE.start_rci;
        self.stats = GameStats::default();
        self.clock = Clock {
            month: START_MONTH_MONTH,
            year: START_MONTH_YEAR,
        };
        self.vehicles.clear();
        self.notifications.clear();
        self.milestones_fired.clear();
        self.tick_count = 0;
        self.next_vehicle_id = 1;
        self.paused = false;
        self.speed = 1;
        self.active_tool = None;
        self.overlay = Overlay::None;
        self.selected_tile = -1;
        self.hover_tile = -1;
        self.menu_index = 0;

        self.mark_networks_dirty();
        recompute_land(&mut self.world);
        self.recompute_stats();
        self.state = GameState::Playing;
        // The camera (a front-end concern) is centred on the stub by the JS wrapper.
    }

    pub fn show_howto(&mut self) {
        self.state = GameState::Howto;
        self.menu_index = 0;
    }
    pub fn back_to_title(&mut self) {
        self.state = GameState::Title;
        self.menu_index = 0;
    }
    pub fn open_pause_menu(&mut self) {
        if self.state == GameState::Playing {
            self.state = GameState::Paused;
            self.menu_index = 0;
        }
    }
    pub fn resume(&mut self) {
        if self.state == GameState::Paused {
            self.state = GameState::Playing;
        }
        self.paused = false;
    }
    pub fn restart(&mut self) {
        self.new_city(MODE.seed);
    }
    pub fn quit_to_menu(&mut self) {
        self.state = GameState::Title;
        self.vehicles.clear();
        self.menu_index = 0;
    }
    pub fn set_state(&mut self, state: GameState) {
        self.state = state;
    }

    // Re-label the carrier components + station bonus + signals after any tool edit.
    pub fn mark_networks_dirty(&mut self) {
        rebuild_networks(&mut self.world);
        compute_station_bonus(&mut self.world);
        rebuild_signals(&self.world, &mut self.signals, &mut self.rng);
    }

    fn declare_bankrupt(&mut self) {
        if self.state == GameState::Bankrupt {
            return;
        }
        self.state = GameState::Bankrupt;
        self.active_tool = None;
        self.paused = false;
        self.notify("CITY BANKRUPT", Tone::Alert);
        self.snd_queue.push(Cue::Alert);
    }

    // ---- The fixed simulation step (DESIGN §4 order) ---------------------------
    pub fn fixed_step(&mut self, dt: f64) {
        if self.state != GameState::Playing || self.paused {
            return;
        }
        self.tick_count += 1;
        step_transit(&mut self.world, &mut self.vehicles, &mut self.rng, &mut self.next_vehicle_id, dt);
        step_utilities(&mut self.world, &mut self.stats);
        step_development(&mut self.world, &self.rci, &mut self.fx_queue);
        step_pollution(&mut self.world);
        recompute_land(&mut self.world);
        self.recompute_stats();
        if self.tick_count % TICKS_PER_MONTH == 0 {
            update_rci(&self.world, &mut self.rci, &self.budget);
            let bankrupt = settle_budget(&self.world, &mut self.budget, &mut self.stats, &mut self.clock);
            self.raise_budget_alert();
            if bankrupt {
                self.declare_bankrupt();
            }
        }
        self.check_milestones();
        self.age_notifications(dt);
    }

    // Aggregate the developed tiles into the HUD stats + the milestone flags in one sweep.
    fn recompute_stats(&mut self) {
        let w = &self.world;
        let mut population = 0.0;
        let mut jobs = 0.0;
        let mut shops = 0.0;
        let mut rail = 0u32;
        let mut tier3 = 0u32;
        let mut district = 0u32;
        for i in 0..TILE_COUNT {
            if w.net[i] & NET_RAIL != 0 {
                rail += 1;
            }
            if !w.developed_at(i) {
                continue;
            }
            let t = w.tier[i] as usize;
            match w.zone[i] {
                1 => population += POP[Z_RES][t],
                2 => {
                    jobs += JOBS[Z_COM][t];
                    shops += SHOP_CAP[Z_COM][t];
                }
                _ => jobs += JOBS[Z_IND][t],
            }
            if w.tier[i] >= 3 {
                tier3 += 1;
            }
            if w.powered[i] != 0 && w.watered[i] != 0 && w.access[i] != 0 {
                district += 1;
            }
        }
        self.stats.population = population;
        self.stats.jobs = jobs;
        self.stats.shops = shops;
        self.stats.peak_population = self.stats.peak_population.max(population);
        self.rail_tiles = rail;
        self.tier3_tiles = tier3;
        self.served_district = district;
    }

    fn check_milestones(&mut self) {
        if self.rail_tiles > 0 {
            self.fire_milestone("first-rail");
        }
        for &threshold in &POP_MILESTONES {
            if self.stats.population >= threshold {
                let id = format!("pop-{}", threshold as i64);
                self.fire_milestone(&id);
            }
        }
        if self.tier3_tiles > 0 {
            self.fire_milestone("first-tier3");
        }
        if self.served_district >= DISTRICT_MILESTONE {
            self.fire_milestone("first-district");
        }
    }

    fn fire_milestone(&mut self, id: &str) {
        if self.milestones_fired.contains(id) {
            return;
        }
        self.milestones_fired.insert(id.to_string());
        let label = MILESTONES
            .iter()
            .find(|(mid, _)| *mid == id)
            .map(|(_, l)| *l)
            .unwrap_or(id);
        self.notify(label, Tone::Good);
        self.snd_queue.push(Cue::Chime);
        // Fireworks: the front end places the burst at the current view centre so the
        // flourish is on-screen (the camera lives in JS), so the position here is a
        // placeholder the front end overrides for `FxKind::Fireworks`.
        self.fx_queue.push(FxEvent {
            kind: FxKind::Fireworks,
            x: 0.0,
            y: 0.0,
            strength: 1.0,
        });
    }

    fn raise_budget_alert(&mut self) {
        if self.budget.balance < 0.0 && self.budget.treasury < MODE.start_treasury * 0.25 {
            self.notify("LOSING MONEY", Tone::Alert);
            self.snd_queue.push(Cue::Alert);
        }
    }

    fn notify(&mut self, text: &str, tone: Tone) {
        self.notifications.push(Notification {
            text: text.to_string(),
            age: 0.0,
            ttl: NOTIFY_TTL,
            tone,
        });
        if self.notifications.len() > MAX_NOTIFICATIONS {
            self.notifications.remove(0);
        }
    }

    fn age_notifications(&mut self, dt: f64) {
        for n in self.notifications.iter_mut() {
            n.age += dt;
        }
        self.notifications.retain(|n| n.age < n.ttl);
    }

    // ---- Player actions --------------------------------------------------------
    pub fn select_tool(&mut self, tool: Option<Tool>) {
        self.active_tool = tool;
    }
    pub fn set_speed(&mut self, n: i32) {
        self.speed = n.clamp(1, 3) as u8;
    }
    pub fn cycle_speed(&mut self) {
        let next = if self.speed >= 3 { 1 } else { self.speed + 1 };
        self.speed = next;
    }
    pub fn set_overlay(&mut self, o: Overlay) {
        self.overlay = o;
    }
    pub fn cycle_overlay(&mut self) {
        self.overlay = match self.overlay {
            Overlay::None => Overlay::Traffic,
            Overlay::Traffic => Overlay::Utility,
            Overlay::Utility => Overlay::Landvalue,
            Overlay::Landvalue => Overlay::None,
        };
    }
    pub fn toggle_pause(&mut self) {
        if self.state == GameState::Playing {
            self.paused = !self.paused;
        }
    }
    pub fn set_tax_rate(&mut self, rate: f64) {
        let stepped = (rate / TAX_STEP).round() * TAX_STEP;
        let rounded = (stepped * 100.0).round() / 100.0; // avoid float drift (TS toFixed(2))
        self.budget.tax_rate = rounded.clamp(TAX_MIN, TAX_MAX);
    }
    pub fn tax_up(&mut self) {
        self.set_tax_rate(self.budget.tax_rate + TAX_STEP);
    }
    pub fn tax_down(&mut self) {
        self.set_tax_rate(self.budget.tax_rate - TAX_STEP);
    }
    pub fn set_hover(&mut self, tile: i32) {
        self.hover_tile = tile;
    }
    pub fn set_selected(&mut self, tile: i32) {
        self.selected_tile = tile;
    }

    // Apply the active tool over an explicit tile list (single click) or a drag run/rectangle.
    pub fn apply_tool_tiles(&mut self, tool: Tool, tiles: &[usize]) -> ApplyResult {
        if self.state != GameState::Playing {
            return ApplyResult::default();
        }
        let res = apply_tool(&mut self.world, &mut self.budget, tool, tiles);
        if res.placed > 0 {
            self.mark_networks_dirty();
            self.snd_queue.push(Cue::Build);
        }
        res
    }
    pub fn apply_drag(&mut self, tool: Tool, c0: i32, r0: i32, c1: i32, r1: i32) -> ApplyResult {
        let tiles = tiles_for_drag(tool, c0, r0, c1, r1);
        self.apply_tool_tiles(tool, &tiles)
    }

    // ---- Menu navigation (owned by the core; the front end draws the list) -----
    pub fn menu_move(&mut self, delta: i32) {
        let len = menu_items(self.state).len() as i32;
        if len == 0 {
            return;
        }
        self.menu_index = (self.menu_index as i32 + delta).rem_euclid(len) as usize;
    }
    pub fn menu_set_index(&mut self, i: usize) {
        let len = menu_items(self.state).len();
        if len > 0 {
            self.menu_index = i.min(len - 1);
        }
    }
    pub fn menu_confirm(&mut self) {
        let items = menu_items(self.state);
        if let Some(item) = items.get(self.menu_index) {
            self.dispatch(item.action);
        }
    }

    /// Dispatch an action string produced by the front end's menu items and HUD clickables.
    /// (The `mute` action is a front-end audio concern and is handled in JS, never here.)
    pub fn dispatch(&mut self, action: &str) {
        if let Some(name) = action.strip_prefix("tool:") {
            if let Some(tool) = Tool::from_name(name) {
                // Click the active tool again to drop it.
                let next = if self.active_tool == Some(tool) { None } else { Some(tool) };
                self.select_tool(next);
            }
            return;
        }
        match action {
            "menu:play" | "menu:again" => self.new_city(MODE.seed),
            "menu:howto" => self.show_howto(),
            "menu:back" | "menu:menu" => self.back_to_title(),
            "menu:resume" => self.resume(),
            "menu:restart" => self.restart(),
            "menu:quit" => self.quit_to_menu(),
            "pause" => self.toggle_pause(),
            "speed" => self.cycle_speed(),
            "overlay" => self.cycle_overlay(),
            "taxUp" => self.tax_up(),
            "taxDown" => self.tax_down(),
            _ => {}
        }
    }

    // ---- Scripted control surface (window.__junction / balance harness) --------
    pub fn zone_rect(&mut self, kind: ZoneKind, c0: i32, r0: i32, c1: i32, r1: i32) -> ApplyResult {
        let tool = match kind {
            ZoneKind::Res => Tool::ZoneRes,
            ZoneKind::Com => Tool::ZoneCom,
            ZoneKind::Ind => Tool::ZoneInd,
        };
        self.apply_drag(tool, c0, r0, c1, r1)
    }
    pub fn road(&mut self, c0: i32, r0: i32, c1: i32, r1: i32) -> ApplyResult {
        self.apply_drag(Tool::Road, c0, r0, c1, r1)
    }
    pub fn rail(&mut self, c0: i32, r0: i32, c1: i32, r1: i32) -> ApplyResult {
        self.apply_drag(Tool::Rail, c0, r0, c1, r1)
    }
    pub fn wire(&mut self, c0: i32, r0: i32, c1: i32, r1: i32) -> ApplyResult {
        self.apply_drag(Tool::Wire, c0, r0, c1, r1)
    }
    pub fn pipe(&mut self, c0: i32, r0: i32, c1: i32, r1: i32) -> ApplyResult {
        self.apply_drag(Tool::Pipe, c0, r0, c1, r1)
    }
    pub fn station(&mut self, col: i32, row: i32) -> ApplyResult {
        self.apply_tool_tiles(Tool::Station, &[idx(col, row)])
    }
    pub fn plant(&mut self, col: i32, row: i32) -> ApplyResult {
        self.apply_tool_tiles(Tool::Plant, &[idx(col, row)])
    }
    pub fn source(&mut self, col: i32, row: i32) -> ApplyResult {
        self.apply_tool_tiles(Tool::Source, &[idx(col, row)])
    }
    pub fn bulldoze_rect(&mut self, c0: i32, r0: i32, c1: i32, r1: i32) -> ApplyResult {
        let tiles = tiles_for_drag(Tool::Bulldoze, c0, r0, c1, r1);
        self.apply_tool_tiles(Tool::Bulldoze, &tiles)
    }

    /// Run `months` whole budget periods of simulation (used by the proof/harness).
    pub fn advance(&mut self, months: f64) {
        let ticks = (months * TICKS_PER_MONTH as f64).round().max(0.0) as i64;
        for _ in 0..ticks {
            if self.state != GameState::Playing {
                break;
            }
            self.fixed_step(FIXED_STEP);
        }
    }

    /// Drop tax to zero so income dries up and upkeep drives the treasury toward the debt
    /// limit — the deliberate slide into bankruptcy for the crisis clip (DESIGN §6).
    pub fn force_bankruptcy(&mut self) {
        self.set_tax_rate(0.0);
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            population: self.stats.population,
            peak_population: self.stats.peak_population,
            treasury: self.budget.treasury.round(),
            balance: self.budget.balance.round(),
            months_survived: self.stats.months_survived,
            bankrupt: self.state == GameState::Bankrupt,
        }
    }
}
