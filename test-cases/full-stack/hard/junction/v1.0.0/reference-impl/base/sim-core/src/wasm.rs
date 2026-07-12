// Junction — the WebAssembly boundary (specs/simulation.md). The thin `#[wasm_bindgen]`
// surface the JS/TS front end drives: it steps the deterministic core, forwards the player's
// actions in, and hands the renderer ZERO-COPY views over the fixed-size tile arrays (via
// stable pointers into linear memory) plus small per-frame snapshots of the moving agents,
// HUD stats, menus, and notifications. Bulk per-tile state never crosses as a copy — the
// front end reads it straight out of memory — so a frame is ~one `step` call plus direct
// reads. This module compiles only for `wasm32`; the pure `Game` it wraps is what the native
// balance harness tests.

use crate::constants::TILE_COUNT;
use crate::game::Game;
use crate::menus::menu_items;
use crate::mode::MODE;
use crate::tools::{can_place, capital_cost_at, source_covering, tiles_for_drag};
use crate::transit::vehicle_pos;
use crate::types::{GameState, Overlay, Tool};
use crate::world::{col_of, row_of};
use wasm_bindgen::prelude::*;

/// A WebAssembly.Memory handle so the front end can build typed-array views over the tile
/// arrays. The views detach when linear memory grows, so the front end re-fetches this and
/// rebuilds them whenever the backing buffer changes (the tile-array pointers stay stable —
/// those Vecs are allocated once and never resized).
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

#[wasm_bindgen]
pub struct Sim {
    game: Game,
}

/// A tool-placement preview for the renderer's ghost / cost / refusal cursor.
#[wasm_bindgen]
pub struct ToolPreview {
    pub cost: f64,
    refusal: Option<String>,
    cells: Vec<u32>, // packed [tile, ok, tile, ok, …]
}

#[wasm_bindgen]
impl ToolPreview {
    #[wasm_bindgen(getter)]
    pub fn refusal(&self) -> Option<String> {
        self.refusal.clone()
    }
    /// Packed [tileIndex, ok(0/1)] pairs for each previewed cell.
    pub fn cells(&self) -> Vec<u32> {
        self.cells.clone()
    }
}

/// The reproducible snapshot the proof hook reads (DESIGN §6).
#[wasm_bindgen]
pub struct SnapshotJs {
    pub population: f64,
    pub peak_population: f64,
    pub treasury: f64,
    pub balance: f64,
    pub months_survived: u32,
    pub bankrupt: bool,
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Sim {
        Sim { game: Game::new() }
    }

    // ---- The tick ----------------------------------------------------------
    pub fn step(&mut self, dt: f64) {
        self.game.fixed_step(dt);
    }
    pub fn advance(&mut self, months: f64) {
        self.game.advance(months);
    }

    // ---- Zero-copy tile-array pointers (byte offsets into linear memory) ----
    pub fn tile_count(&self) -> usize {
        TILE_COUNT
    }
    pub fn terrain_ptr(&self) -> usize {
        self.game.world.terrain.as_ptr() as usize
    }
    pub fn zone_ptr(&self) -> usize {
        self.game.world.zone.as_ptr() as usize
    }
    pub fn net_ptr(&self) -> usize {
        self.game.world.net.as_ptr() as usize
    }
    pub fn tier_ptr(&self) -> usize {
        self.game.world.tier.as_ptr() as usize
    }
    pub fn powered_ptr(&self) -> usize {
        self.game.world.powered.as_ptr() as usize
    }
    pub fn watered_ptr(&self) -> usize {
        self.game.world.watered.as_ptr() as usize
    }
    pub fn access_ptr(&self) -> usize {
        self.game.world.access.as_ptr() as usize
    }
    pub fn build_ptr(&self) -> usize {
        self.game.world.build.as_ptr() as usize
    }
    pub fn decay_ptr(&self) -> usize {
        self.game.world.decay.as_ptr() as usize
    }
    pub fn pollution_ptr(&self) -> usize {
        self.game.world.pollution.as_ptr() as usize
    }
    pub fn land_ptr(&self) -> usize {
        self.game.world.land.as_ptr() as usize
    }
    pub fn load_ptr(&self) -> usize {
        self.game.world.load.as_ptr() as usize
    }
    pub fn cap_ptr(&self) -> usize {
        self.game.world.cap.as_ptr() as usize
    }

    // ---- Small per-frame snapshots (copied; all tiny) ----------------------
    /// Packed [x, y, angle, kindCode, animT] per visible vehicle.
    pub fn vehicles(&self) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.game.vehicles.len() * 5);
        for v in &self.game.vehicles {
            let (x, y) = vehicle_pos(v);
            out.push(x as f32);
            out.push(y as f32);
            out.push(v.angle as f32);
            out.push(v.kind as u8 as f32);
            out.push(v.anim_t as f32);
        }
        out
    }
    /// Packed [col, row, phase] per animated junction signal.
    pub fn signals(&self) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.game.signals.len() * 3);
        for s in &self.game.signals {
            out.push(s.col as f32);
            out.push(s.row as f32);
            out.push(s.phase as f32);
        }
        out
    }
    /// Packed [col, row, kindCode, capacity, supplied] per placed 2×2 source.
    pub fn sources(&self) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.game.world.sources.len() * 5);
        for s in &self.game.world.sources {
            out.push(s.col as f32);
            out.push(s.row as f32);
            out.push(s.kind as u8 as f32);
            out.push(s.capacity as f32);
            out.push(s.supplied as f32);
        }
        out
    }

    // ---- Presentation queues (drained each frame) --------------------------
    /// Drain the produced-audio cues queued this frame (cue codes).
    pub fn drain_sounds(&mut self) -> Vec<u32> {
        let out: Vec<u32> = self.game.snd_queue.iter().map(|c| *c as u32).collect();
        self.game.snd_queue.clear();
        out
    }
    /// Drain the particle events queued this frame: packed [kindCode, x, y, strength].
    pub fn drain_fx(&mut self) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.game.fx_queue.len() * 4);
        for e in &self.game.fx_queue {
            out.push(e.kind as u8 as f32);
            out.push(e.x as f32);
            out.push(e.y as f32);
            out.push(e.strength as f32);
        }
        self.game.fx_queue.clear();
        out
    }

    // ---- Scalar / aggregate getters ----------------------------------------
    pub fn state(&self) -> u32 {
        self.game.state as u32
    }
    pub fn overlay(&self) -> u32 {
        self.game.overlay as u32
    }
    pub fn active_tool(&self) -> i32 {
        match self.game.active_tool {
            Some(t) => t as i32,
            None => -1,
        }
    }
    pub fn paused(&self) -> bool {
        self.game.paused
    }
    pub fn speed(&self) -> u32 {
        self.game.speed as u32
    }
    pub fn hover_tile(&self) -> i32 {
        self.game.hover_tile
    }
    pub fn selected_tile(&self) -> i32 {
        self.game.selected_tile
    }
    pub fn treasury(&self) -> f64 {
        self.game.budget.treasury
    }
    pub fn income(&self) -> f64 {
        self.game.budget.income
    }
    pub fn upkeep(&self) -> f64 {
        self.game.budget.upkeep
    }
    pub fn balance(&self) -> f64 {
        self.game.budget.balance
    }
    pub fn tax_rate(&self) -> f64 {
        self.game.budget.tax_rate
    }
    pub fn population(&self) -> f64 {
        self.game.stats.population
    }
    pub fn jobs(&self) -> f64 {
        self.game.stats.jobs
    }
    pub fn shops(&self) -> f64 {
        self.game.stats.shops
    }
    pub fn peak_population(&self) -> f64 {
        self.game.stats.peak_population
    }
    pub fn months_survived(&self) -> u32 {
        self.game.stats.months_survived
    }
    pub fn power_supply(&self) -> f64 {
        self.game.stats.power.supply
    }
    pub fn power_demand(&self) -> f64 {
        self.game.stats.power.demand
    }
    pub fn water_supply(&self) -> f64 {
        self.game.stats.water.supply
    }
    pub fn water_demand(&self) -> f64 {
        self.game.stats.water.demand
    }
    pub fn rci_r(&self) -> f64 {
        self.game.rci.r
    }
    pub fn rci_c(&self) -> f64 {
        self.game.rci.c
    }
    pub fn rci_d(&self) -> f64 {
        self.game.rci.d
    }
    pub fn clock_month(&self) -> u32 {
        self.game.clock.month
    }
    pub fn clock_year(&self) -> u32 {
        self.game.clock.year
    }

    // ---- Menus (owned by the core; the front end draws the list) -----------
    pub fn menu_index(&self) -> usize {
        self.game.menu_index
    }
    pub fn menu_len(&self) -> usize {
        menu_items(self.game.state).len()
    }
    pub fn menu_label(&self, i: usize) -> String {
        menu_items(self.game.state).get(i).map(|m| m.label.clone()).unwrap_or_default()
    }
    pub fn menu_action(&self, i: usize) -> String {
        menu_items(self.game.state)
            .get(i)
            .map(|m| m.action.to_string())
            .unwrap_or_default()
    }
    pub fn menu_move(&mut self, delta: i32) {
        self.game.menu_move(delta);
    }
    pub fn menu_set_index(&mut self, i: usize) {
        self.game.menu_set_index(i);
    }
    pub fn menu_confirm(&mut self) {
        self.game.menu_confirm();
    }

    // Mode / title metadata (the camera-focus tile the front end centres on).
    pub fn mode_menu_label(&self) -> String {
        MODE.menu_label.to_string()
    }
    pub fn mode_tagline(&self) -> String {
        MODE.tagline.to_string()
    }
    pub fn center_col(&self) -> i32 {
        MODE.center_col
    }
    pub fn center_row(&self) -> i32 {
        MODE.center_row
    }

    // ---- Notifications -----------------------------------------------------
    pub fn notif_len(&self) -> usize {
        self.game.notifications.len()
    }
    pub fn notif_text(&self, i: usize) -> String {
        self.game.notifications.get(i).map(|n| n.text.clone()).unwrap_or_default()
    }
    pub fn notif_age(&self, i: usize) -> f32 {
        self.game.notifications.get(i).map(|n| n.age as f32).unwrap_or(0.0)
    }
    pub fn notif_ttl(&self, i: usize) -> f32 {
        self.game.notifications.get(i).map(|n| n.ttl as f32).unwrap_or(0.0)
    }
    pub fn notif_tone(&self, i: usize) -> u32 {
        self.game.notifications.get(i).map(|n| n.tone as u32).unwrap_or(0)
    }

    // ---- Tool preview (legality + cost + refusal, computed in Rust) --------
    pub fn tool_preview(&self, anchor: i32, hover: i32) -> ToolPreview {
        let empty = ToolPreview {
            cost: 0.0,
            refusal: None,
            cells: Vec::new(),
        };
        let tool = match self.game.active_tool {
            Some(t) => t,
            None => return empty,
        };
        if self.game.state != GameState::Playing || hover < 0 {
            return empty;
        }
        let w = &self.game.world;
        let anchor = if anchor >= 0 { anchor as usize } else { hover as usize };
        let hover = hover as usize;
        let mut cells: Vec<u32> = Vec::new();
        let mut cost = 0.0;
        let mut refusal: Option<String> = None;

        if tool == Tool::Plant || tool == Tool::Source {
            let chk = can_place(w, tool, anchor);
            let c0 = col_of(anchor);
            let r0 = row_of(anchor);
            for r in r0..=r0 + 1 {
                for c in c0..=c0 + 1 {
                    if c >= 0 && c < crate::constants::MAP_COLS as i32 && r >= 0 && r < crate::constants::MAP_ROWS as i32 {
                        cells.push(crate::world::idx(c, r) as u32);
                        cells.push(chk.ok as u32);
                    }
                }
            }
            if chk.ok {
                cost = capital_cost_at(w, tool, anchor);
            } else {
                refusal = Some(chk.reason.unwrap_or("CAN'T BUILD HERE").to_string());
            }
        } else if tool == Tool::Bulldoze {
            for i in tiles_for_drag(tool, col_of(anchor), row_of(anchor), col_of(hover), row_of(hover)) {
                let ok = w.net[i] != 0 || w.zone[i] != 0 || source_covering(w, i).is_some();
                cells.push(i as u32);
                cells.push(ok as u32);
            }
        } else {
            for i in tiles_for_drag(tool, col_of(anchor), row_of(anchor), col_of(hover), row_of(hover)) {
                let chk = can_place(w, tool, i);
                cells.push(i as u32);
                cells.push(chk.ok as u32);
                if chk.ok {
                    cost += capital_cost_at(w, tool, i);
                } else if refusal.is_none() {
                    refusal = chk.reason.map(|s| s.to_string());
                }
            }
            if cost > self.game.budget.treasury && refusal.is_none() {
                refusal = Some("NOT ENOUGH FUNDS".to_string());
            }
        }
        ToolPreview { cost, refusal, cells }
    }

    // ---- Player actions ----------------------------------------------------
    pub fn select_tool(&mut self, tool: i32) {
        self.game.select_tool(if tool < 0 { None } else { Tool::from_code(tool as u32) });
    }
    pub fn dispatch(&mut self, action: &str) {
        self.game.dispatch(action);
    }
    /// Apply a drag-painted tool (zone rectangle / carrier run); returns the tiles placed.
    pub fn apply_drag(&mut self, tool: u32, c0: i32, r0: i32, c1: i32, r1: i32) -> u32 {
        match Tool::from_code(tool) {
            Some(t) => self.game.apply_drag(t, c0, r0, c1, r1).placed,
            None => 0,
        }
    }
    /// Apply a single-stamp tool (station / plant / source); returns 1 if placed, else 0.
    pub fn apply_stamp(&mut self, tool: u32, col: i32, row: i32) -> u32 {
        match Tool::from_code(tool) {
            Some(t) => self.game.apply_tool_tiles(t, &[crate::world::idx(col, row)]).placed,
            None => 0,
        }
    }
    pub fn set_hover(&mut self, tile: i32) {
        self.game.set_hover(tile);
    }
    pub fn set_selected(&mut self, tile: i32) {
        self.game.set_selected(tile);
    }
    pub fn set_speed(&mut self, n: i32) {
        self.game.set_speed(n);
    }
    pub fn cycle_speed(&mut self) {
        self.game.cycle_speed();
    }
    pub fn set_overlay(&mut self, o: u32) {
        self.game.set_overlay(Overlay::from_code(o));
    }
    pub fn cycle_overlay(&mut self) {
        self.game.cycle_overlay();
    }
    pub fn toggle_pause(&mut self) {
        self.game.toggle_pause();
    }
    pub fn tax_up(&mut self) {
        self.game.tax_up();
    }
    pub fn tax_down(&mut self) {
        self.game.tax_down();
    }
    pub fn set_tax(&mut self, rate: f64) {
        self.game.set_tax_rate(rate);
    }

    // ---- State machine -----------------------------------------------------
    pub fn new_city(&mut self) {
        self.game.new_city(MODE.seed);
    }
    pub fn new_city_seeded(&mut self, seed: u32) {
        self.game.new_city(seed);
    }
    pub fn show_howto(&mut self) {
        self.game.show_howto();
    }
    pub fn back_to_title(&mut self) {
        self.game.back_to_title();
    }
    pub fn open_pause_menu(&mut self) {
        self.game.open_pause_menu();
    }
    pub fn resume(&mut self) {
        self.game.resume();
    }
    pub fn restart(&mut self) {
        self.game.restart();
    }
    pub fn quit_to_menu(&mut self) {
        self.game.quit_to_menu();
    }
    pub fn set_state(&mut self, code: u32) {
        if let Some(s) = GameState::from_code(code) {
            self.game.set_state(s);
        }
    }

    // ---- Scripted control surface (window.__junction, DESIGN §6) -----------
    // The named per-tool helpers (`road`, `zoneRect`, `source`, …) are composed on the JS
    // side from `apply_drag` / `apply_stamp`; the boundary keeps only what those cannot do.
    /// Set the treasury directly — the proof/harness uses it to stage a starting balance or a
    /// near-debt-limit crisis (DESIGN §6).
    pub fn set_treasury(&mut self, value: f64) {
        self.game.budget.treasury = value;
    }
    pub fn force_bankruptcy(&mut self) {
        self.game.force_bankruptcy();
    }
    pub fn snapshot(&self) -> SnapshotJs {
        let s = self.game.snapshot();
        SnapshotJs {
            population: s.population,
            peak_population: s.peak_population,
            treasury: s.treasury,
            balance: s.balance,
            months_survived: s.months_survived,
            bankrupt: s.bankrupt,
        }
    }
}

impl Default for Sim {
    fn default() -> Self {
        Sim::new()
    }
}
