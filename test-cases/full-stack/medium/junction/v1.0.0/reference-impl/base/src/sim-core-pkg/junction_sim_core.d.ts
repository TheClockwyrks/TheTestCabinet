/* tslint:disable */
/* eslint-disable */

export class Sim {
    free(): void;
    [Symbol.dispose](): void;
    access_ptr(): number;
    active_tool(): number;
    advance(months: number): void;
    /**
     * Apply a drag-painted tool (zone rectangle / carrier run); returns the tiles placed.
     */
    apply_drag(tool: number, c0: number, r0: number, c1: number, r1: number): number;
    /**
     * Apply a single-stamp tool (station / plant / source); returns 1 if placed, else 0.
     */
    apply_stamp(tool: number, col: number, row: number): number;
    back_to_title(): void;
    balance(): number;
    build_ptr(): number;
    cap_ptr(): number;
    center_col(): number;
    center_row(): number;
    clock_month(): number;
    clock_year(): number;
    cycle_overlay(): void;
    cycle_speed(): void;
    decay_ptr(): number;
    dispatch(action: string): void;
    /**
     * Drain the particle events queued this frame: packed [kindCode, x, y, strength].
     */
    drain_fx(): Float32Array;
    /**
     * Drain the produced-audio cues queued this frame (cue codes).
     */
    drain_sounds(): Uint32Array;
    force_bankruptcy(): void;
    hover_tile(): number;
    income(): number;
    jobs(): number;
    land_ptr(): number;
    load_ptr(): number;
    menu_action(i: number): string;
    menu_confirm(): void;
    menu_index(): number;
    menu_label(i: number): string;
    menu_len(): number;
    menu_move(delta: number): void;
    menu_set_index(i: number): void;
    mode_menu_label(): string;
    mode_tagline(): string;
    months_survived(): number;
    net_ptr(): number;
    constructor();
    new_city(): void;
    new_city_seeded(seed: number): void;
    notif_age(i: number): number;
    notif_len(): number;
    notif_text(i: number): string;
    notif_tone(i: number): number;
    notif_ttl(i: number): number;
    open_pause_menu(): void;
    overlay(): number;
    paused(): boolean;
    peak_population(): number;
    pollution_ptr(): number;
    population(): number;
    power_demand(): number;
    power_supply(): number;
    powered_ptr(): number;
    quit_to_menu(): void;
    rci_c(): number;
    rci_d(): number;
    rci_r(): number;
    restart(): void;
    resume(): void;
    select_tool(tool: number): void;
    selected_tile(): number;
    set_hover(tile: number): void;
    set_overlay(o: number): void;
    set_selected(tile: number): void;
    set_speed(n: number): void;
    set_state(code: number): void;
    set_tax(rate: number): void;
    /**
     * Set the treasury directly — the proof/harness uses it to stage a starting balance or a
     * near-debt-limit crisis (DESIGN §6).
     */
    set_treasury(value: number): void;
    shops(): number;
    show_howto(): void;
    /**
     * Packed [col, row, phase] per animated junction signal.
     */
    signals(): Float32Array;
    snapshot(): SnapshotJs;
    /**
     * Packed [col, row, kindCode, capacity, supplied] per placed 2×2 source.
     */
    sources(): Float32Array;
    speed(): number;
    state(): number;
    step(dt: number): void;
    tax_down(): void;
    tax_rate(): number;
    tax_up(): void;
    terrain_ptr(): number;
    tier_ptr(): number;
    tile_count(): number;
    toggle_pause(): void;
    tool_preview(anchor: number, hover: number): ToolPreview;
    treasury(): number;
    upkeep(): number;
    /**
     * Packed [x, y, angle, kindCode, animT] per visible vehicle.
     */
    vehicles(): Float32Array;
    water_demand(): number;
    water_supply(): number;
    watered_ptr(): number;
    zone_ptr(): number;
}

/**
 * The reproducible snapshot the proof hook reads (DESIGN §6).
 */
export class SnapshotJs {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    balance: number;
    bankrupt: boolean;
    months_survived: number;
    peak_population: number;
    population: number;
    treasury: number;
}

/**
 * A tool-placement preview for the renderer's ghost / cost / refusal cursor.
 */
export class ToolPreview {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Packed [tileIndex, ok(0/1)] pairs for each previewed cell.
     */
    cells(): Uint32Array;
    cost: number;
    readonly refusal: string | undefined;
}

/**
 * A WebAssembly.Memory handle so the front end can build typed-array views over the tile
 * arrays. The views detach when linear memory grows, so the front end re-fetches this and
 * rebuilds them whenever the backing buffer changes (the tile-array pointers stay stable —
 * those Vecs are allocated once and never resized).
 */
export function wasm_memory(): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_snapshotjs_balance: (a: number) => number;
    readonly __wbg_get_snapshotjs_bankrupt: (a: number) => number;
    readonly __wbg_get_snapshotjs_months_survived: (a: number) => number;
    readonly __wbg_get_snapshotjs_peak_population: (a: number) => number;
    readonly __wbg_get_snapshotjs_population: (a: number) => number;
    readonly __wbg_get_snapshotjs_treasury: (a: number) => number;
    readonly __wbg_set_snapshotjs_balance: (a: number, b: number) => void;
    readonly __wbg_set_snapshotjs_bankrupt: (a: number, b: number) => void;
    readonly __wbg_set_snapshotjs_months_survived: (a: number, b: number) => void;
    readonly __wbg_set_snapshotjs_peak_population: (a: number, b: number) => void;
    readonly __wbg_set_snapshotjs_population: (a: number, b: number) => void;
    readonly __wbg_set_snapshotjs_treasury: (a: number, b: number) => void;
    readonly __wbg_sim_free: (a: number, b: number) => void;
    readonly __wbg_snapshotjs_free: (a: number, b: number) => void;
    readonly __wbg_toolpreview_free: (a: number, b: number) => void;
    readonly sim_access_ptr: (a: number) => number;
    readonly sim_active_tool: (a: number) => number;
    readonly sim_advance: (a: number, b: number) => void;
    readonly sim_apply_drag: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly sim_apply_stamp: (a: number, b: number, c: number, d: number) => number;
    readonly sim_back_to_title: (a: number) => void;
    readonly sim_balance: (a: number) => number;
    readonly sim_build_ptr: (a: number) => number;
    readonly sim_cap_ptr: (a: number) => number;
    readonly sim_center_col: (a: number) => number;
    readonly sim_center_row: (a: number) => number;
    readonly sim_clock_month: (a: number) => number;
    readonly sim_clock_year: (a: number) => number;
    readonly sim_cycle_overlay: (a: number) => void;
    readonly sim_cycle_speed: (a: number) => void;
    readonly sim_decay_ptr: (a: number) => number;
    readonly sim_dispatch: (a: number, b: number, c: number) => void;
    readonly sim_drain_fx: (a: number) => [number, number];
    readonly sim_drain_sounds: (a: number) => [number, number];
    readonly sim_force_bankruptcy: (a: number) => void;
    readonly sim_hover_tile: (a: number) => number;
    readonly sim_income: (a: number) => number;
    readonly sim_jobs: (a: number) => number;
    readonly sim_land_ptr: (a: number) => number;
    readonly sim_load_ptr: (a: number) => number;
    readonly sim_menu_action: (a: number, b: number) => [number, number];
    readonly sim_menu_confirm: (a: number) => void;
    readonly sim_menu_index: (a: number) => number;
    readonly sim_menu_label: (a: number, b: number) => [number, number];
    readonly sim_menu_len: (a: number) => number;
    readonly sim_menu_move: (a: number, b: number) => void;
    readonly sim_menu_set_index: (a: number, b: number) => void;
    readonly sim_mode_menu_label: (a: number) => [number, number];
    readonly sim_mode_tagline: (a: number) => [number, number];
    readonly sim_months_survived: (a: number) => number;
    readonly sim_net_ptr: (a: number) => number;
    readonly sim_new: () => number;
    readonly sim_new_city: (a: number) => void;
    readonly sim_new_city_seeded: (a: number, b: number) => void;
    readonly sim_notif_age: (a: number, b: number) => number;
    readonly sim_notif_len: (a: number) => number;
    readonly sim_notif_text: (a: number, b: number) => [number, number];
    readonly sim_notif_tone: (a: number, b: number) => number;
    readonly sim_notif_ttl: (a: number, b: number) => number;
    readonly sim_open_pause_menu: (a: number) => void;
    readonly sim_overlay: (a: number) => number;
    readonly sim_paused: (a: number) => number;
    readonly sim_peak_population: (a: number) => number;
    readonly sim_pollution_ptr: (a: number) => number;
    readonly sim_population: (a: number) => number;
    readonly sim_power_demand: (a: number) => number;
    readonly sim_power_supply: (a: number) => number;
    readonly sim_powered_ptr: (a: number) => number;
    readonly sim_quit_to_menu: (a: number) => void;
    readonly sim_rci_c: (a: number) => number;
    readonly sim_rci_d: (a: number) => number;
    readonly sim_rci_r: (a: number) => number;
    readonly sim_resume: (a: number) => void;
    readonly sim_select_tool: (a: number, b: number) => void;
    readonly sim_selected_tile: (a: number) => number;
    readonly sim_set_hover: (a: number, b: number) => void;
    readonly sim_set_overlay: (a: number, b: number) => void;
    readonly sim_set_selected: (a: number, b: number) => void;
    readonly sim_set_speed: (a: number, b: number) => void;
    readonly sim_set_state: (a: number, b: number) => void;
    readonly sim_set_tax: (a: number, b: number) => void;
    readonly sim_set_treasury: (a: number, b: number) => void;
    readonly sim_shops: (a: number) => number;
    readonly sim_show_howto: (a: number) => void;
    readonly sim_signals: (a: number) => [number, number];
    readonly sim_snapshot: (a: number) => number;
    readonly sim_sources: (a: number) => [number, number];
    readonly sim_speed: (a: number) => number;
    readonly sim_state: (a: number) => number;
    readonly sim_step: (a: number, b: number) => void;
    readonly sim_tax_down: (a: number) => void;
    readonly sim_tax_rate: (a: number) => number;
    readonly sim_tax_up: (a: number) => void;
    readonly sim_terrain_ptr: (a: number) => number;
    readonly sim_tier_ptr: (a: number) => number;
    readonly sim_tile_count: (a: number) => number;
    readonly sim_toggle_pause: (a: number) => void;
    readonly sim_tool_preview: (a: number, b: number, c: number) => number;
    readonly sim_treasury: (a: number) => number;
    readonly sim_upkeep: (a: number) => number;
    readonly sim_vehicles: (a: number) => [number, number];
    readonly sim_water_demand: (a: number) => number;
    readonly sim_water_supply: (a: number) => number;
    readonly sim_watered_ptr: (a: number) => number;
    readonly sim_zone_ptr: (a: number) => number;
    readonly toolpreview_cells: (a: number) => [number, number];
    readonly toolpreview_refusal: (a: number) => [number, number];
    readonly wasm_memory: () => any;
    readonly __wbg_get_toolpreview_cost: (a: number) => number;
    readonly __wbg_set_toolpreview_cost: (a: number, b: number) => void;
    readonly sim_restart: (a: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
