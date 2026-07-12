// Junction — the network graph: connected-component labelling per carrier and the weighted
// path search the transit flow rides (specs/transit.md, DESIGN §4), ported from `graph.ts`.
//
// `rebuild_networks` re-labels the road / rail / wire / pipe components into the world's
// `*_net` arrays; it is rebuilt on any edit. The transit flow routes over the road+rail
// graph with `route_field` — a multi-source Dijkstra rooted at the trip destinations,
// weighted by LIVE per-link travel time (a link's weight rises with its congestion),
// returning a shortest-path tree the transit module walks to lay load onto links. Rail
// steps are cheaper than road (RAIL_SPEED_MULT) and stations bridge the two, so
// through-traffic prefers a parallel rail line — the observable payoff the spec asks for.

use crate::constants::*;
use crate::world::{col_of, idx, in_bounds, row_of, World, NEIGHBORS};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

const ROAD_STEP: f64 = 1.0; // base travel cost of entering a road tile (tiles)

fn rail_step() -> f64 {
    1.0 / RAIL_SPEED_MULT
}

// A tile participates in the transit graph as a road node, a rail node, or both (a station
// carries the rail line AND connects to the road, so it is the transfer point).
fn road_mode(w: &World, i: usize) -> bool {
    w.net[i] & (NET_ROAD | NET_STATION) != 0
}
fn rail_mode(w: &World, i: usize) -> bool {
    w.net[i] & (NET_RAIL | NET_STATION) != 0
}
pub fn is_transit_node(w: &World, i: usize) -> bool {
    w.net[i] & (NET_ROAD | NET_RAIL | NET_STATION) != 0
}

// Congestion multiplier on a link from its previous-tick load vs capacity (specs/transit.md):
// within capacity flows at full speed (×1); over capacity, travel time climbs linearly.
fn congestion(w: &World, i: usize) -> f64 {
    let cap = w.cap[i] as f64;
    if cap <= 0.0 {
        return 1.0;
    }
    1.0 + CONGEST_K * (w.prev_load[i] as f64 / cap - 1.0).max(0.0)
}

// The cost of stepping from node `from` into neighbour `to` — the cheaper of the road step
// and the rail step where both modes are shared, each scaled by `to`'s live congestion.
fn step_weight(w: &World, from: usize, to: usize) -> f64 {
    let mut best = f64::INFINITY;
    if road_mode(w, from) && road_mode(w, to) {
        best = best.min(ROAD_STEP * congestion(w, to));
    }
    if rail_mode(w, from) && rail_mode(w, to) {
        best = best.min(rail_step() * congestion(w, to));
    }
    best
}

// ---- Connected components per carrier (rebuilt on any edit) ---------------------
pub fn rebuild_networks(w: &mut World) {
    label_components(w, NET_ROAD, NetField::Road);
    label_components(w, NET_RAIL | NET_STATION, NetField::Rail);
    label_components(w, NET_WIRE, NetField::Power);
    label_components(w, NET_PIPE, NetField::Water);
}

#[derive(Clone, Copy)]
enum NetField {
    Road,
    Rail,
    Power,
    Water,
}

fn label_components(w: &mut World, mask: u8, field: NetField) {
    // Take the target array out of the world so the flood fill can borrow `w.net` immutably.
    let mut out = match field {
        NetField::Road => std::mem::take(&mut w.road_net),
        NetField::Rail => std::mem::take(&mut w.rail_net),
        NetField::Power => std::mem::take(&mut w.power_net),
        NetField::Water => std::mem::take(&mut w.water_net),
    };
    for v in out.iter_mut() {
        *v = -1;
    }
    let mut id: i16 = 0;
    let mut stack: Vec<usize> = Vec::new();
    for i in 0..TILE_COUNT {
        if w.net[i] & mask == 0 || out[i] >= 0 {
            continue;
        }
        out[i] = id;
        stack.clear();
        stack.push(i);
        while let Some(cur) = stack.pop() {
            let col = col_of(cur);
            let row = row_of(cur);
            for (dc, dr) in NEIGHBORS {
                let nc = col + dc;
                let nr = row + dr;
                if !in_bounds(nc, nr) {
                    continue;
                }
                let j = idx(nc, nr);
                if w.net[j] & mask != 0 && out[j] < 0 {
                    out[j] = id;
                    stack.push(j);
                }
            }
        }
        id += 1;
    }
    match field {
        NetField::Road => w.road_net = out,
        NetField::Rail => w.rail_net = out,
        NetField::Power => w.power_net = out,
        NetField::Water => w.water_net = out,
    }
}

// ---- A min-heap keyed by tentative distance ------------------------------------
struct HeapItem {
    key: f64,
    node: usize,
}
impl PartialEq for HeapItem {
    fn eq(&self, other: &Self) -> bool {
        self.key == other.key
    }
}
impl Eq for HeapItem {}
impl Ord for HeapItem {
    // Reverse ordering so `BinaryHeap` (a max-heap) pops the SMALLEST key first.
    fn cmp(&self, other: &Self) -> Ordering {
        other.key.total_cmp(&self.key)
    }
}
impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

// A shortest-path tree over the transit graph, rooted at every source tile (dist 0). For
// each reached node, `parent` points to the neighbour one step CLOSER to a source, so a
// trip origin walks parents to reach the nearest destination, laying load as it goes.
pub struct RouteField {
    pub dist: Vec<f64>,
    pub parent: Vec<i32>,
}

pub fn route_field(w: &World, sources: &[usize]) -> RouteField {
    let mut dist = vec![f64::INFINITY; TILE_COUNT];
    let mut parent = vec![-1i32; TILE_COUNT];
    let mut done = vec![false; TILE_COUNT];
    let mut heap: BinaryHeap<HeapItem> = BinaryHeap::new();
    for &s in sources {
        if is_transit_node(w, s) && dist[s] > 0.0 {
            dist[s] = 0.0;
            heap.push(HeapItem { key: 0.0, node: s });
        }
    }
    while let Some(HeapItem { node: u, .. }) = heap.pop() {
        if done[u] {
            continue;
        }
        done[u] = true;
        let col = col_of(u);
        let row = row_of(u);
        let du = dist[u];
        for (dc, dr) in NEIGHBORS {
            let nc = col + dc;
            let nr = row + dr;
            if !in_bounds(nc, nr) {
                continue;
            }
            let v = idx(nc, nr);
            if done[v] || !is_transit_node(w, v) {
                continue;
            }
            let wgt = step_weight(w, u, v);
            if !wgt.is_finite() {
                continue;
            }
            let nd = du + wgt;
            if nd < dist[v] {
                dist[v] = nd;
                parent[v] = u as i32; // v steps to u to move toward a source
                heap.push(HeapItem { key: nd, node: v });
            }
        }
    }
    RouteField { dist, parent }
}
