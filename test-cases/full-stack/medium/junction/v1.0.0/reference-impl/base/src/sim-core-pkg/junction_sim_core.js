/* @ts-self-types="./junction_sim_core.d.ts" */

export class Sim {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SimFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sim_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    access_ptr() {
        const ret = wasm.sim_access_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    active_tool() {
        const ret = wasm.sim_active_tool(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} months
     */
    advance(months) {
        wasm.sim_advance(this.__wbg_ptr, months);
    }
    /**
     * Apply a drag-painted tool (zone rectangle / carrier run); returns the tiles placed.
     * @param {number} tool
     * @param {number} c0
     * @param {number} r0
     * @param {number} c1
     * @param {number} r1
     * @returns {number}
     */
    apply_drag(tool, c0, r0, c1, r1) {
        const ret = wasm.sim_apply_drag(this.__wbg_ptr, tool, c0, r0, c1, r1);
        return ret >>> 0;
    }
    /**
     * Apply a single-stamp tool (station / plant / source); returns 1 if placed, else 0.
     * @param {number} tool
     * @param {number} col
     * @param {number} row
     * @returns {number}
     */
    apply_stamp(tool, col, row) {
        const ret = wasm.sim_apply_stamp(this.__wbg_ptr, tool, col, row);
        return ret >>> 0;
    }
    back_to_title() {
        wasm.sim_back_to_title(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    balance() {
        const ret = wasm.sim_balance(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    build_ptr() {
        const ret = wasm.sim_build_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    cap_ptr() {
        const ret = wasm.sim_cap_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    center_col() {
        const ret = wasm.sim_center_col(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    center_row() {
        const ret = wasm.sim_center_row(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    clock_month() {
        const ret = wasm.sim_clock_month(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    clock_year() {
        const ret = wasm.sim_clock_year(this.__wbg_ptr);
        return ret >>> 0;
    }
    cycle_overlay() {
        wasm.sim_cycle_overlay(this.__wbg_ptr);
    }
    cycle_speed() {
        wasm.sim_cycle_speed(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    decay_ptr() {
        const ret = wasm.sim_decay_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {string} action
     */
    dispatch(action) {
        const ptr0 = passStringToWasm0(action, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.sim_dispatch(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Drain the particle events queued this frame: packed [kindCode, x, y, strength].
     * @returns {Float32Array}
     */
    drain_fx() {
        const ret = wasm.sim_drain_fx(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Drain the produced-audio cues queued this frame (cue codes).
     * @returns {Uint32Array}
     */
    drain_sounds() {
        const ret = wasm.sim_drain_sounds(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    force_bankruptcy() {
        wasm.sim_force_bankruptcy(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    hover_tile() {
        const ret = wasm.sim_hover_tile(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    income() {
        const ret = wasm.sim_income(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    jobs() {
        const ret = wasm.sim_jobs(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    land_ptr() {
        const ret = wasm.sim_land_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    load_ptr() {
        const ret = wasm.sim_load_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {string}
     */
    menu_action(i) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.sim_menu_action(this.__wbg_ptr, i);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    menu_confirm() {
        wasm.sim_menu_confirm(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    menu_index() {
        const ret = wasm.sim_menu_index(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {string}
     */
    menu_label(i) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.sim_menu_label(this.__wbg_ptr, i);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    menu_len() {
        const ret = wasm.sim_menu_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} delta
     */
    menu_move(delta) {
        wasm.sim_menu_move(this.__wbg_ptr, delta);
    }
    /**
     * @param {number} i
     */
    menu_set_index(i) {
        wasm.sim_menu_set_index(this.__wbg_ptr, i);
    }
    /**
     * @returns {string}
     */
    mode_menu_label() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.sim_mode_menu_label(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    mode_tagline() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.sim_mode_tagline(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    months_survived() {
        const ret = wasm.sim_months_survived(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    net_ptr() {
        const ret = wasm.sim_net_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    constructor() {
        const ret = wasm.sim_new();
        this.__wbg_ptr = ret;
        SimFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    new_city() {
        wasm.sim_new_city(this.__wbg_ptr);
    }
    /**
     * @param {number} seed
     */
    new_city_seeded(seed) {
        wasm.sim_new_city_seeded(this.__wbg_ptr, seed);
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    notif_age(i) {
        const ret = wasm.sim_notif_age(this.__wbg_ptr, i);
        return ret;
    }
    /**
     * @returns {number}
     */
    notif_len() {
        const ret = wasm.sim_notif_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {string}
     */
    notif_text(i) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.sim_notif_text(this.__wbg_ptr, i);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    notif_tone(i) {
        const ret = wasm.sim_notif_tone(this.__wbg_ptr, i);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {number}
     */
    notif_ttl(i) {
        const ret = wasm.sim_notif_ttl(this.__wbg_ptr, i);
        return ret;
    }
    open_pause_menu() {
        wasm.sim_open_pause_menu(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    overlay() {
        const ret = wasm.sim_overlay(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    paused() {
        const ret = wasm.sim_paused(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    peak_population() {
        const ret = wasm.sim_peak_population(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    pollution_ptr() {
        const ret = wasm.sim_pollution_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    population() {
        const ret = wasm.sim_population(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    power_demand() {
        const ret = wasm.sim_power_demand(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    power_supply() {
        const ret = wasm.sim_power_supply(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    powered_ptr() {
        const ret = wasm.sim_powered_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    quit_to_menu() {
        wasm.sim_quit_to_menu(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    rci_c() {
        const ret = wasm.sim_rci_c(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    rci_d() {
        const ret = wasm.sim_rci_d(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    rci_r() {
        const ret = wasm.sim_rci_r(this.__wbg_ptr);
        return ret;
    }
    restart() {
        wasm.sim_restart(this.__wbg_ptr);
    }
    resume() {
        wasm.sim_resume(this.__wbg_ptr);
    }
    /**
     * @param {number} tool
     */
    select_tool(tool) {
        wasm.sim_select_tool(this.__wbg_ptr, tool);
    }
    /**
     * @returns {number}
     */
    selected_tile() {
        const ret = wasm.sim_selected_tile(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} tile
     */
    set_hover(tile) {
        wasm.sim_set_hover(this.__wbg_ptr, tile);
    }
    /**
     * @param {number} o
     */
    set_overlay(o) {
        wasm.sim_set_overlay(this.__wbg_ptr, o);
    }
    /**
     * @param {number} tile
     */
    set_selected(tile) {
        wasm.sim_set_selected(this.__wbg_ptr, tile);
    }
    /**
     * @param {number} n
     */
    set_speed(n) {
        wasm.sim_set_speed(this.__wbg_ptr, n);
    }
    /**
     * @param {number} code
     */
    set_state(code) {
        wasm.sim_set_state(this.__wbg_ptr, code);
    }
    /**
     * @param {number} rate
     */
    set_tax(rate) {
        wasm.sim_set_tax(this.__wbg_ptr, rate);
    }
    /**
     * Set the treasury directly — the proof/harness uses it to stage a starting balance or a
     * near-debt-limit crisis (DESIGN §6).
     * @param {number} value
     */
    set_treasury(value) {
        wasm.sim_set_treasury(this.__wbg_ptr, value);
    }
    /**
     * @returns {number}
     */
    shops() {
        const ret = wasm.sim_shops(this.__wbg_ptr);
        return ret;
    }
    show_howto() {
        wasm.sim_show_howto(this.__wbg_ptr);
    }
    /**
     * Packed [col, row, phase] per animated junction signal.
     * @returns {Float32Array}
     */
    signals() {
        const ret = wasm.sim_signals(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {SnapshotJs}
     */
    snapshot() {
        const ret = wasm.sim_snapshot(this.__wbg_ptr);
        return SnapshotJs.__wrap(ret);
    }
    /**
     * Packed [col, row, kindCode, capacity, supplied] per placed 2×2 source.
     * @returns {Float32Array}
     */
    sources() {
        const ret = wasm.sim_sources(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    speed() {
        const ret = wasm.sim_speed(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    state() {
        const ret = wasm.sim_state(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} dt
     */
    step(dt) {
        wasm.sim_step(this.__wbg_ptr, dt);
    }
    tax_down() {
        wasm.sim_tax_down(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    tax_rate() {
        const ret = wasm.sim_tax_rate(this.__wbg_ptr);
        return ret;
    }
    tax_up() {
        wasm.sim_tax_up(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    terrain_ptr() {
        const ret = wasm.sim_terrain_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    tier_ptr() {
        const ret = wasm.sim_tier_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    tile_count() {
        const ret = wasm.sim_tile_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    toggle_pause() {
        wasm.sim_toggle_pause(this.__wbg_ptr);
    }
    /**
     * @param {number} anchor
     * @param {number} hover
     * @returns {ToolPreview}
     */
    tool_preview(anchor, hover) {
        const ret = wasm.sim_tool_preview(this.__wbg_ptr, anchor, hover);
        return ToolPreview.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    treasury() {
        const ret = wasm.sim_treasury(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    upkeep() {
        const ret = wasm.sim_upkeep(this.__wbg_ptr);
        return ret;
    }
    /**
     * Packed [x, y, angle, kindCode, animT] per visible vehicle.
     * @returns {Float32Array}
     */
    vehicles() {
        const ret = wasm.sim_vehicles(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    water_demand() {
        const ret = wasm.sim_water_demand(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    water_supply() {
        const ret = wasm.sim_water_supply(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    watered_ptr() {
        const ret = wasm.sim_watered_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    zone_ptr() {
        const ret = wasm.sim_zone_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) Sim.prototype[Symbol.dispose] = Sim.prototype.free;

/**
 * The reproducible snapshot the proof hook reads (DESIGN §6).
 */
export class SnapshotJs {
    static __wrap(ptr) {
        const obj = Object.create(SnapshotJs.prototype);
        obj.__wbg_ptr = ptr;
        SnapshotJsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SnapshotJsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_snapshotjs_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get balance() {
        const ret = wasm.__wbg_get_snapshotjs_balance(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get bankrupt() {
        const ret = wasm.__wbg_get_snapshotjs_bankrupt(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get months_survived() {
        const ret = wasm.__wbg_get_snapshotjs_months_survived(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get peak_population() {
        const ret = wasm.__wbg_get_snapshotjs_peak_population(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get population() {
        const ret = wasm.__wbg_get_snapshotjs_population(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get treasury() {
        const ret = wasm.__wbg_get_snapshotjs_treasury(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set balance(arg0) {
        wasm.__wbg_set_snapshotjs_balance(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set bankrupt(arg0) {
        wasm.__wbg_set_snapshotjs_bankrupt(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set months_survived(arg0) {
        wasm.__wbg_set_snapshotjs_months_survived(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set peak_population(arg0) {
        wasm.__wbg_set_snapshotjs_peak_population(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set population(arg0) {
        wasm.__wbg_set_snapshotjs_population(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set treasury(arg0) {
        wasm.__wbg_set_snapshotjs_treasury(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) SnapshotJs.prototype[Symbol.dispose] = SnapshotJs.prototype.free;

/**
 * A tool-placement preview for the renderer's ghost / cost / refusal cursor.
 */
export class ToolPreview {
    static __wrap(ptr) {
        const obj = Object.create(ToolPreview.prototype);
        obj.__wbg_ptr = ptr;
        ToolPreviewFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ToolPreviewFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_toolpreview_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get cost() {
        const ret = wasm.__wbg_get_toolpreview_cost(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set cost(arg0) {
        wasm.__wbg_set_toolpreview_cost(this.__wbg_ptr, arg0);
    }
    /**
     * Packed [tileIndex, ok(0/1)] pairs for each previewed cell.
     * @returns {Uint32Array}
     */
    cells() {
        const ret = wasm.toolpreview_cells(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {string | undefined}
     */
    get refusal() {
        const ret = wasm.toolpreview_refusal(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) ToolPreview.prototype[Symbol.dispose] = ToolPreview.prototype.free;

/**
 * A WebAssembly.Memory handle so the front end can build typed-array views over the tile
 * arrays. The views detach when linear memory grows, so the front end re-fetches this and
 * rebuilds them whenever the backing buffer changes (the tile-array pointers stay stable —
 * those Vecs are allocated once and never resized).
 * @returns {any}
 */
export function wasm_memory() {
    const ret = wasm.wasm_memory();
    return ret;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_memory_de265df8aadd6273: function() {
            const ret = wasm.memory;
            return ret;
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./junction_sim_core_bg.js": import0,
    };
}

const SimFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sim_free(ptr, 1));
const SnapshotJsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_snapshotjs_free(ptr, 1));
const ToolPreviewFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_toolpreview_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('junction_sim_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
