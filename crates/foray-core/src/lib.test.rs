//! Unit tests for the Foray engine.
//!
//! The tests build small, hand-laid boards (via the TOML loader) so every tile is
//! known and outcomes can be asserted exactly, and they exercise each rule the
//! case turns on: the carry-weight cadence, banking, tagging (load scatter +
//! respawn), jelly immunity, the sweep and time-limit win conditions, and replay
//! round-trip + reconstruction determinism.

use super::*;
use crate::board::{Board, BoardParams, Pos, Team};
use crate::config::{BoardParamsSerde, Rules, Simulation};
use crate::contract::{Action, Dir, Move, World};
use crate::engine::Match;
use crate::map_artifacts::{MAP_ID, MAP_SEED};
use crate::replay::{Participants, RecordHeader, Replay, ReplayError, TickInput};
use crate::state::{Ended, MatchState, Role};

// ---------------------------------------------------------------------------
// Test fixtures: tiny, fully open boards laid out by hand.
// ---------------------------------------------------------------------------

/// A wide-open `8 x 3` board (no interior walls) with nests at the far columns,
/// so movement, crossing, and banking are easy to reason about. The middle row is
/// `y == 1`. Border between columns 3 and 4 (`border_x == 4`): Red owns `0..4`,
/// Blue owns `4..8`.
fn open_board() -> Board {
    // Only the frame edges are walls; the interior is fully open. We place no
    // seeds/jelly here; tests that need them lay their own via the state.
    let mut walls = Vec::new();
    for x in 0..8 {
        walls.push([x, 0]);
        walls.push([x, 2]);
    }
    let doc = MapDoc {
        id: "open-8x3".into(),
        width: 8,
        height: 3,
        border_x: 4,
        seed: 0,
        red_nest: [0, 1],
        blue_nest: [7, 1],
        walls,
        red_seeds: vec![],
        blue_seeds: vec![],
        red_jelly: vec![],
        blue_jelly: vec![],
    };
    Board::from_map(&doc.to_toml()).expect("hand-laid board loads")
}

/// A wide-open `20 x 3` board (no interior walls), border between columns 9 and
/// 10 (`border_x == 10`): Red owns `0..10`, Blue owns `10..20`. Wide enough to
/// count an agent's move cadence over a full `move_resolution` window without it
/// crossing the border (which would flip its role and speed).
fn wide_board() -> Board {
    let mut walls = Vec::new();
    for x in 0..20 {
        walls.push([x, 0]);
        walls.push([x, 2]);
    }
    let doc = MapDoc {
        id: "open-20x3".into(),
        width: 20,
        height: 3,
        border_x: 10,
        seed: 0,
        red_nest: [0, 1],
        blue_nest: [19, 1],
        walls,
        red_seeds: vec![],
        blue_seeds: vec![],
        red_jelly: vec![],
        blue_jelly: vec![],
    };
    Board::from_map(&doc.to_toml()).expect("hand-laid board loads")
}

/// Count how many of the next `move_resolution` ticks a Red agent placed at
/// `start` carrying `carrying` actually steps east on [`wide_board`]. From rest
/// this equals the agent's per-tick `move_speed`, so it is the clean handle on the
/// carry-weight speed model.
fn moves_in_window(start: Pos, carrying: u32) -> u32 {
    let board = wide_board();
    let mut game = Match::new(board, rules(), sim());
    {
        let agent = game
            .state
            .agents
            .iter_mut()
            .find(|a| a.team == Team::Red && a.id == 0)
            .unwrap();
        agent.pos = start;
        agent.carrying = carrying;
    }
    let mut prev = start;
    let mut count = 0;
    for _ in 0..rules().move_resolution {
        game.step(&move_one(0, Dir::E), &stop());
        let p = game.state.agents[0].pos;
        if p != prev {
            count += 1;
            prev = p;
        }
    }
    count
}

/// A minimal helper mirroring the on-disk map document so tests can build boards
/// without reaching into the private loader struct.
struct MapDoc {
    id: String,
    width: i32,
    height: i32,
    border_x: i32,
    seed: u64,
    red_nest: [i32; 2],
    blue_nest: [i32; 2],
    walls: Vec<[i32; 2]>,
    red_seeds: Vec<[i32; 2]>,
    blue_seeds: Vec<[i32; 2]>,
    red_jelly: Vec<[i32; 2]>,
    blue_jelly: Vec<[i32; 2]>,
}

impl MapDoc {
    fn to_toml(&self) -> String {
        let arr = |tiles: &[[i32; 2]]| {
            tiles
                .iter()
                .map(|t| format!("[{}, {}]", t[0], t[1]))
                .collect::<Vec<_>>()
                .join(", ")
        };
        format!(
            "id = \"{}\"\nwidth = {}\nheight = {}\nborder_x = {}\nseed = {}\n\
             red_nest = [{}, {}]\nblue_nest = [{}, {}]\n\
             walls = [{}]\nred_seeds = [{}]\nblue_seeds = [{}]\n\
             red_jelly = [{}]\nblue_jelly = [{}]\n",
            self.id,
            self.width,
            self.height,
            self.border_x,
            self.seed,
            self.red_nest[0],
            self.red_nest[1],
            self.blue_nest[0],
            self.blue_nest[1],
            arr(&self.walls),
            arr(&self.red_seeds),
            arr(&self.blue_seeds),
            arr(&self.red_jelly),
            arr(&self.blue_jelly),
        )
    }
}

/// An action moving one agent and stopping the rest.
fn move_one(agent: u32, dir: Dir) -> Action {
    let mut moves = vec![Move { agent, dir }];
    for other in 0..3 {
        if other != agent {
            moves.push(Move {
                agent: other,
                dir: Dir::Stop,
            });
        }
    }
    Action { moves }
}

fn stop() -> Action {
    Action::all_stop()
}

fn rules() -> Rules {
    Rules::default()
}

fn sim() -> Simulation {
    Simulation::default()
}

/// Place a single Red agent (id 0) at `pos` with `carrying`, the other agents off
/// in their nest, and return the match.
fn match_with_red_at(board: Board, pos: Pos, carrying: u32) -> Match {
    let mut game = Match::new(board, rules(), sim());
    let agent = game
        .state
        .agents
        .iter_mut()
        .find(|a| a.team == Team::Red && a.id == 0)
        .unwrap();
    agent.pos = pos;
    agent.carrying = carrying;
    game
}

// ---------------------------------------------------------------------------
// Board generation & map round-trip.
// ---------------------------------------------------------------------------

#[test]
fn generated_maze_is_mirror_symmetric_and_deterministic() {
    let a = Board::generate(MAP_ID, BoardParams::default(), MAP_SEED);
    let b = Board::generate(MAP_ID, BoardParams::default(), MAP_SEED);
    assert_eq!(a, b, "the same seed regenerates the identical maze");

    for y in 0..a.height {
        for x in 0..a.width {
            let p = Pos::new(x, y);
            assert_eq!(
                a.is_wall(p),
                a.is_wall(a.mirror(p)),
                "wall at {p:?} must mirror across the centre"
            );
        }
    }
    // Fixtures mirror too: every Red cache/jelly has its Blue twin.
    for seed in a.initial_seeds(Team::Red) {
        assert!(a.initial_seeds(Team::Blue).contains(&a.mirror(*seed)));
    }
    assert_eq!(a.initial_seeds(Team::Red).len(), 20);
    assert_eq!(a.initial_jelly(Team::Red).len(), 2);
}

#[test]
fn map_toml_round_trips_losslessly() {
    let original = Board::generate(MAP_ID, BoardParams::default(), MAP_SEED);
    let toml = original.to_map_toml();
    let loaded = Board::from_map(&toml).expect("the generated map reloads");
    assert_eq!(
        original, loaded,
        "generate -> to_map_toml -> from_map is identity"
    );
}

#[test]
fn committed_map_matches_the_generator() {
    // Guards the on-disk artifact: if the generator changes, `gen-artifacts` must
    // be re-run. Reads the committed file relative to the crate root.
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/maps/mirror-32x16.toml");
    let on_disk = std::fs::read_to_string(path).expect("the committed map exists");
    let regenerated = Board::generate(MAP_ID, BoardParams::default(), MAP_SEED).to_map_toml();
    assert_eq!(
        on_disk, regenerated,
        "run `cargo run -p foray-core --bin gen-artifacts`"
    );
}

#[test]
fn committed_schemas_match_the_types() {
    for (file, generated) in [
        ("schemas/world.json", contract::world_schema_string()),
        ("schemas/action.json", contract::action_schema_string()),
    ] {
        let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), file);
        let on_disk = std::fs::read_to_string(&path).expect("the committed schema exists");
        assert_eq!(
            on_disk, generated,
            "run `cargo run -p foray-core --bin gen-artifacts`"
        );
    }
}

// ---------------------------------------------------------------------------
// Roles & movement clamping.
// ---------------------------------------------------------------------------

#[test]
fn role_is_derived_from_the_half_the_agent_stands_on() {
    let board = open_board();
    let state = MatchState::new(&board);
    let red = state.agents.iter().find(|a| a.team == Team::Red).unwrap();
    assert_eq!(
        red.role(&board),
        Role::Soldier,
        "in its own nest a Red agent is a soldier"
    );

    // Move it conceptually onto Blue's half.
    let mut raider = red.clone();
    raider.pos = Pos::new(5, 1);
    assert_eq!(
        raider.role(&board),
        Role::Raider,
        "on the enemy half it is a raider"
    );
}

#[test]
fn blocked_or_offboard_move_clamps_to_stop_never_forfeits() {
    let board = open_board();
    // Red 0 at the west nest (0,1); West/North are walls or off-board.
    let mut game = Match::new(board, rules(), sim());
    let start = game.state.agents[0].pos;
    game.step(&move_one(0, Dir::W), &stop()); // off-board west
    assert_eq!(game.state.agents[0].pos, start, "off-board move is a no-op");
    game.step(&move_one(0, Dir::N), &stop()); // into the top wall
    assert_eq!(game.state.agents[0].pos, start, "wall move is a no-op");
    assert!(
        game.result().is_none(),
        "a clamped move never ends the match"
    );
}

// ---------------------------------------------------------------------------
// Carry-weight cadence — the signature mechanic.
// ---------------------------------------------------------------------------

#[test]
fn light_raider_moves_every_tick_and_outpaces_a_soldier() {
    // A light raider (load <= light_load) earns the full resolution each tick, so
    // it steps every tick — the board's one-tile-per-tick cap. A soldier earns
    // less, so over a full window it steps once fewer: the raider's Pac-Man-style
    // speed edge that lets a colony actually make progress.
    let res = rules().move_resolution;
    assert_eq!(
        moves_in_window(Pos::new(10, 1), 0),
        res,
        "a light raider moves every tick"
    );
    assert_eq!(
        moves_in_window(Pos::new(1, 1), 0),
        rules().soldier_speed,
        "a soldier moves just under one tile per tick"
    );
    assert!(
        rules().soldier_speed < res,
        "a soldier is strictly slower than a light raider"
    );
}

#[test]
fn raider_speed_scales_symmetrically_with_load() {
    // Over a resolution window an agent steps once per point of move_speed. Loads
    // through light_load keep the full speed; the soldier-speed crossover sits at
    // light_load + 1 and is symmetric — one seed lighter than the crossover is as
    // much faster than a soldier as one seed heavier is slower.
    let res = rules().move_resolution; // 8
    let soldier = rules().soldier_speed; // 7
    let light = rules().light_load; // 3
    let penalty = res - soldier; // per-seed speed loss past light_load
    let raider = |load| moves_in_window(Pos::new(10, 1), load);

    for load in 0..=light {
        assert_eq!(raider(load), res, "load {load} keeps the full raider speed");
    }
    assert_eq!(
        raider(light + 1),
        soldier,
        "the crossover load matches a soldier exactly"
    );
    let bonus = raider(light) - soldier; // light raider's edge over a soldier
    let deficit = soldier - raider(light + 2); // its deficit one seed past crossover
    assert_eq!(bonus, deficit, "the speed bonus and deficit are symmetric");
    assert_eq!(
        raider(light + 2),
        soldier - penalty,
        "each extra seed past the crossover costs one penalty step"
    );
    assert_eq!(
        raider(50),
        rules().min_speed,
        "an over-loaded raider crawls at the floor speed, never freezing"
    );
}

#[test]
fn laden_raider_stalls_between_steps_under_carry_weight() {
    let board = open_board();
    // A heavy load (7) drops the raider's speed to half the resolution
    // (move_speed 4 of 8), so it steps every other tick.
    let mut game = match_with_red_at(board, Pos::new(4, 1), 7);
    let p0 = game.state.agents[0].pos;
    game.step(&move_one(0, Dir::E), &stop());
    assert_eq!(
        game.state.agents[0].pos, p0,
        "a heavy raider stalls on the first tick"
    );
    game.step(&move_one(0, Dir::E), &stop());
    assert_eq!(
        game.state.agents[0].pos,
        Pos::new(5, 1),
        "it steps on the second tick"
    );
    game.step(&move_one(0, Dir::E), &stop());
    assert_eq!(
        game.state.agents[0].pos,
        Pos::new(5, 1),
        "stalls again after stepping"
    );
    game.step(&move_one(0, Dir::E), &stop());
    assert_eq!(
        game.state.agents[0].pos,
        Pos::new(6, 1),
        "moves every other tick"
    );
}

#[test]
fn can_move_this_tick_matches_the_speed_model_in_the_observation() {
    let board = open_board();
    // load 7 -> speed 4: from rest it has not yet banked a step this tick.
    let mut game = match_with_red_at(board, Pos::new(4, 1), 7);
    let world = game.observe(Team::Red);
    let agent0 = world.my_agents.iter().find(|a| a.id == 0).unwrap();
    assert!(
        !agent0.can_move_this_tick,
        "a heavy raider has not yet banked a full step"
    );
    // After one held tick it has banked enough to step next tick.
    game.step(&stop(), &stop());
    let world = game.observe(Team::Red);
    let agent0 = world.my_agents.iter().find(|a| a.id == 0).unwrap();
    assert!(
        agent0.can_move_this_tick,
        "eligible after banking charge for one tick"
    );
}

#[test]
fn agents_cannot_swap_tiles() {
    // A Blue raider on Red's half and a Red soldier sit adjacent and try to trade
    // tiles in one tick. Swapping would let the raider pass *through* the soldier
    // untagged, so the swap is cancelled and both hold; the tag lands a tick later
    // when the soldier steps onto the (now stationary) raider.
    let board = open_board();
    let mut game = Match::new(board, rules(), sim());
    let res = rules().move_resolution;
    {
        let blue0 = game
            .state
            .agents
            .iter_mut()
            .find(|a| a.team == Team::Blue && a.id == 0)
            .unwrap();
        blue0.pos = Pos::new(2, 1); // Red's half -> a raider
        blue0.carrying = 1;
        blue0.move_accum = res; // banked, so it is eligible to move this tick
    }
    {
        let red0 = game
            .state
            .agents
            .iter_mut()
            .find(|a| a.team == Team::Red && a.id == 0)
            .unwrap();
        red0.pos = Pos::new(1, 1); // own half -> a soldier
        red0.move_accum = res;
    }

    // Red 0: (1,1) -> (2,1) east; Blue 0: (2,1) -> (1,1) west — a swap.
    game.step(&move_one(0, Dir::E), &move_one(0, Dir::W));
    let red0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Red && a.id == 0)
        .unwrap();
    let blue0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    assert_eq!(
        red0.pos,
        Pos::new(1, 1),
        "the soldier holds — no pass-through"
    );
    assert_eq!(
        blue0.pos,
        Pos::new(2, 1),
        "the raider holds — no pass-through"
    );
    assert_eq!(
        blue0.carrying, 1,
        "the raider was not tagged through the swap"
    );

    // Next tick the soldier steps onto the raider (a move-onto, not a swap) and
    // tags it — proving only the exchange was blocked, not contact.
    game.step(&move_one(0, Dir::E), &stop());
    let blue0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    assert_eq!(
        blue0.pos,
        game.board.nest(Team::Blue),
        "stepping onto the raider tags it"
    );
}

#[test]
fn soldiers_swap_across_the_seam() {
    // Two soldiers meeting head-on at the central seam (each on its own half,
    // crossing into the other's) put *no tag* at stake, so the swap resolves: they
    // pass through each other. This is the case that must NOT be cancelled — if it
    // were, two controllers both beelining for the nearest crossing would deadlock
    // on the seam forever and neither could ever raid.
    let board = open_board(); // border_x == 4: Red owns 0..4, Blue owns 4..8
    let mut game = Match::new(board, rules(), sim());
    let res = rules().move_resolution;
    {
        let red0 = game
            .state
            .agents
            .iter_mut()
            .find(|a| a.team == Team::Red && a.id == 0)
            .unwrap();
        red0.pos = Pos::new(3, 1); // Red's half -> a soldier, against the seam
        red0.move_accum = res;
    }
    {
        let blue0 = game
            .state
            .agents
            .iter_mut()
            .find(|a| a.team == Team::Blue && a.id == 0)
            .unwrap();
        blue0.pos = Pos::new(4, 1); // Blue's half -> a soldier, against the seam
        blue0.move_accum = res;
    }

    // Red 0: (3,1) -> (4,1) east; Blue 0: (4,1) -> (3,1) west — a soldier/soldier
    // swap across the seam.
    game.step(&move_one(0, Dir::E), &move_one(0, Dir::W));
    let red0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Red && a.id == 0)
        .unwrap();
    let blue0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    assert_eq!(
        red0.pos,
        Pos::new(4, 1),
        "the two soldiers pass through each other — Red crosses the seam"
    );
    assert_eq!(
        blue0.pos,
        Pos::new(3, 1),
        "the two soldiers pass through each other — Blue crosses the seam"
    );
}

// ---------------------------------------------------------------------------
// Eating, banking.
// ---------------------------------------------------------------------------

#[test]
fn raider_eats_an_enemy_cache_into_its_load() {
    let board = open_board();
    let mut game = match_with_red_at(board, Pos::new(4, 1), 0);
    // Lay a Blue-half cache at (5,1) for the Red raider to eat.
    game.state.blue_caches.insert(Pos::new(5, 1));
    game.state.blue_seeds_total = 1;
    game.step(&move_one(0, Dir::E), &stop());
    assert_eq!(
        game.state.agents[0].carrying, 1,
        "stepping onto the cache eats it"
    );
    assert!(
        !game.state.blue_caches.contains(&Pos::new(5, 1)),
        "the cache is consumed"
    );
}

#[test]
fn banking_adds_the_load_to_score_and_resets_it() {
    let board = open_board();
    // Red raider on Blue's half at (4,1) carrying 2 (load 2 <= light_load, so it
    // still moves every tick), steps west across the border to (3,1) — its own
    // half — banking everything.
    let mut game = match_with_red_at(board, Pos::new(4, 1), 2);
    game.step(&move_one(0, Dir::W), &stop());
    assert_eq!(game.state.agents[0].pos, Pos::new(3, 1));
    assert_eq!(
        game.state.score.red, 2,
        "crossing home banks the whole load"
    );
    assert_eq!(game.state.agents[0].carrying, 0, "load resets on banking");
}

#[test]
fn staying_on_the_enemy_half_does_not_bank() {
    let board = open_board();
    // Load 2 keeps the light raider at full speed, so it actually steps deeper
    // into Blue's half; staying on the enemy half banks nothing.
    let mut game = match_with_red_at(board, Pos::new(5, 1), 2);
    game.step(&move_one(0, Dir::E), &stop()); // moves deeper into Blue's half
    assert_eq!(
        game.state.agents[0].pos,
        Pos::new(6, 1),
        "it stepped, not banked"
    );
    assert_eq!(game.state.score.red, 0, "no crossing, no bank");
    assert_eq!(game.state.agents[0].carrying, 2);
}

// ---------------------------------------------------------------------------
// Tagging & respawn.
// ---------------------------------------------------------------------------

#[test]
fn soldier_tags_enemy_raider_scattering_load_and_respawning_it() {
    let board = open_board();
    let mut game = Match::new(board, rules(), sim());
    // Blue 0 is a raider on Red's half at (2,1) carrying 2.
    let blue0 = game
        .state
        .agents
        .iter_mut()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    blue0.pos = Pos::new(2, 1);
    blue0.carrying = 2;
    // Red 0 is a soldier that steps onto (2,1) to tag. Bank its charge so it is
    // eligible to step this tick (a soldier earns just under a full step per tick).
    let red0 = game
        .state
        .agents
        .iter_mut()
        .find(|a| a.team == Team::Red && a.id == 0)
        .unwrap();
    red0.pos = Pos::new(1, 1);
    red0.move_accum = rules().move_resolution;

    game.step(&move_one(0, Dir::E), &stop()); // Red 0: (1,1) -> (2,1)

    let blue0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    assert_eq!(
        blue0.pos,
        game.board.nest(Team::Blue),
        "tagged raider respawns at its nest"
    );
    assert_eq!(blue0.carrying, 0, "its carried load is dropped");
    // The two dropped seeds are now recoverable caches on Red's (the defender's) half.
    assert_eq!(
        game.state.red_caches.len(),
        2,
        "the dropped load scatters as caches"
    );
    assert!(
        game.state
            .red_caches
            .iter()
            .all(|c| game.board.team_of_column(c.x) == Team::Red)
    );
    assert_eq!(
        game.state.kills,
        Kills { red: 1, blue: 0 },
        "Red tagged one Blue raider — one kill credited to Red"
    );
}

#[test]
fn immune_raider_cannot_be_tagged() {
    let board = open_board();
    let mut game = Match::new(board, rules(), sim());
    let blue0 = game
        .state
        .agents
        .iter_mut()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    blue0.pos = Pos::new(2, 1);
    blue0.carrying = 2;
    blue0.immune_ticks = 5; // jelly immunity
    let red0 = game
        .state
        .agents
        .iter_mut()
        .find(|a| a.team == Team::Red && a.id == 0)
        .unwrap();
    red0.pos = Pos::new(2, 1); // already co-located

    game.step(&stop(), &stop());

    let blue0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    assert_eq!(
        blue0.pos,
        Pos::new(2, 1),
        "an immune raider is not respawned"
    );
    assert_eq!(blue0.carrying, 2, "an immune raider keeps its load");
    assert_eq!(blue0.immune_ticks, 4, "immunity decrements by one per tick");
    assert_eq!(
        game.state.kills,
        Kills::default(),
        "an immune raider that cannot be tagged is not a kill"
    );
}

// ---------------------------------------------------------------------------
// Royal jelly.
// ---------------------------------------------------------------------------

#[test]
fn jelly_grants_immunity_and_blocks_a_following_tag() {
    let board = open_board();
    let mut game = Match::new(board, rules(), sim());
    // Blue 0 raider on Red's half steps onto a jelly node.
    let blue0 = game
        .state
        .agents
        .iter_mut()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    blue0.pos = Pos::new(3, 1);
    game.state.red_jelly.insert(Pos::new(2, 1));

    game.step(&stop(), &move_one(0, Dir::W)); // Blue 0: (3,1) -> (2,1) onto jelly

    let blue0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    // J = 40, minus the one decrement at the end of this tick.
    assert_eq!(
        blue0.immune_ticks,
        rules().jelly_immunity_ticks - 1,
        "jelly grants J ticks"
    );
    assert!(
        !game.state.red_jelly.contains(&Pos::new(2, 1)),
        "the jelly node is consumed"
    );

    // Now a Red soldier moving onto the immune raider cannot tag it.
    let red0 = game
        .state
        .agents
        .iter_mut()
        .find(|a| a.team == Team::Red && a.id == 0)
        .unwrap();
    red0.pos = Pos::new(1, 1);
    red0.move_accum = rules().move_resolution; // eligible to step this tick
    game.step(&move_one(0, Dir::E), &stop()); // Red 0 -> (2,1), onto the immune raider
    let blue0 = game
        .state
        .agents
        .iter()
        .find(|a| a.team == Team::Blue && a.id == 0)
        .unwrap();
    assert_eq!(blue0.pos, Pos::new(2, 1), "jelly immunity blocks the tag");
}

// ---------------------------------------------------------------------------
// Win conditions.
// ---------------------------------------------------------------------------

#[test]
fn sweeping_all_enemy_seeds_wins_immediately() {
    let board = open_board();
    let mut game = Match::new(board, rules(), sim());
    // Blue's half has exactly one seed to take; Red eats and banks it.
    game.state.blue_caches.insert(Pos::new(4, 1));
    game.state.blue_seeds_total = 1;
    let red0 = game
        .state
        .agents
        .iter_mut()
        .find(|a| a.team == Team::Red && a.id == 0)
        .unwrap();
    red0.pos = Pos::new(4, 1); // on the seed already (a raider)

    // Tick 1: eat the only Blue seed.
    game.step(&stop(), &stop());
    assert_eq!(game.state.agents[0].carrying, 1);
    assert!(game.result().is_none(), "carrying is not yet a sweep");
    // Tick 2: cross home to bank -> Red has banked all of Blue's seeds.
    let result = game
        .step(&move_one(0, Dir::W), &stop())
        .expect("banking the last seed ends it");
    assert_eq!(result.ended, Ended::Swept);
    assert_eq!(result.winner, Some(Team::Red));
}

#[test]
fn time_limit_decides_on_score_and_ties_are_a_draw() {
    let board = open_board();
    let short = Simulation {
        timestep_ms: 16,
        max_ticks: 1,
    };

    // Higher score wins at the cap.
    let mut game = Match::new(board.clone(), rules(), short);
    game.state.score.red = 3;
    game.state.score.blue = 1;
    let result = game.step(&stop(), &stop()).expect("the cap ends the match");
    assert_eq!(result.ended, Ended::TimeLimit);
    assert_eq!(result.winner, Some(Team::Red));

    // Equal score is a draw.
    let mut game = Match::new(board, rules(), short);
    game.state.score.red = 2;
    game.state.score.blue = 2;
    let result = game.step(&stop(), &stop()).expect("the cap ends the match");
    assert_eq!(result.ended, Ended::TimeLimit);
    assert_eq!(result.winner, None, "equal banked score is a draw");
}

#[test]
fn forfeit_result_is_representable() {
    let board = open_board();
    let mut game = Match::new(board, rules(), sim());
    game.state.score.red = 1;
    let result = crate::tick::forfeit(&mut game.state, Team::Blue);
    assert_eq!(result.ended, Ended::Forfeit);
    assert_eq!(
        result.winner,
        Some(Team::Red),
        "the non-forfeiting team wins"
    );
    assert!(game.is_over());
}

// ---------------------------------------------------------------------------
// Contract validation.
// ---------------------------------------------------------------------------

#[test]
fn action_validation_rejects_unowned_duplicate_and_missing_agents() {
    let board = open_board();
    let state = MatchState::new(&board);
    // Valid: exactly Red's three ids.
    let ok = Action {
        moves: vec![
            Move {
                agent: 0,
                dir: Dir::Stop,
            },
            Move {
                agent: 1,
                dir: Dir::N,
            },
            Move {
                agent: 2,
                dir: Dir::S,
            },
        ],
    };
    assert!(ok.validate_for(Team::Red, &state).is_ok());

    // Unowned agent id (only 0..3 exist per team).
    let unowned = Action {
        moves: vec![Move {
            agent: 9,
            dir: Dir::N,
        }],
    };
    assert!(unowned.validate_for(Team::Red, &state).is_err());

    // Duplicate agent.
    let dup = Action {
        moves: vec![
            Move {
                agent: 0,
                dir: Dir::N,
            },
            Move {
                agent: 0,
                dir: Dir::S,
            },
        ],
    };
    assert!(dup.validate_for(Team::Red, &state).is_err());

    // Missing an agent.
    let missing = Action {
        moves: vec![Move {
            agent: 0,
            dir: Dir::N,
        }],
    };
    assert!(missing.validate_for(Team::Red, &state).is_err());
}

#[test]
fn world_and_action_json_round_trip() {
    let board = open_board();
    let game = Match::new(board, rules(), sim());
    let world = game.observe(Team::Red);
    let json = serde_json::to_string(&world).unwrap();
    let back: World = serde_json::from_str(&json).unwrap();
    assert_eq!(world, back, "the observation round-trips through JSON");

    let action = move_one(1, Dir::E);
    let json = serde_json::to_string(&action).unwrap();
    let back: Action = serde_json::from_str(&json).unwrap();
    assert_eq!(action, back, "an action round-trips through JSON");
}

// ---------------------------------------------------------------------------
// Replay round-trip & reconstruction determinism.
// ---------------------------------------------------------------------------

/// Run a short scripted match on the committed map and capture its inputs.
fn scripted_match() -> (Board, Vec<TickInput>, MatchResult) {
    let board = Board::generate(MAP_ID, BoardParams::default(), MAP_SEED);
    let mut game = Match::new(
        board.clone(),
        rules(),
        Simulation {
            timestep_ms: 16,
            max_ticks: 50,
        },
    );
    let mut ticks = Vec::new();
    let mut result = None;
    // Drive a deterministic but non-trivial script: both teams push east/west.
    let script = [Dir::E, Dir::S, Dir::W, Dir::N, Dir::E, Dir::E];
    for t in 0..50 {
        let dir = script[t % script.len()];
        let red = Action {
            moves: (0..3).map(|a| Move { agent: a, dir }).collect(),
        };
        let blue = Action {
            moves: (0..3)
                .map(|a| Move {
                    agent: a,
                    dir: Dir::Stop,
                })
                .collect(),
        };
        ticks.push(TickInput {
            red: red.clone(),
            blue: blue.clone(),
        });
        if let Some(r) = game.step(&red, &blue) {
            result = Some(r);
            break;
        }
    }
    let result = result.unwrap_or_else(|| {
        // Force termination at the (low) cap if no win occurred.
        game.state.result.unwrap_or(MatchResult {
            winner: None,
            score: game.state.score,
            kills: game.state.kills,
            ended: Ended::TimeLimit,
            ticks: game.state.tick,
        })
    });
    (board, ticks, result)
}

/// The replay header the reconstruction tests share (the scripted match's loop
/// config and the committed map identity).
fn header(red: &str, blue: &str) -> RecordHeader {
    RecordHeader {
        map: MAP_ID.into(),
        seed: MAP_SEED,
        participants: Participants {
            red: red.into(),
            blue: blue.into(),
        },
        board: BoardParamsSerde::default(),
        rules: rules(),
        sim: Simulation {
            timestep_ms: 16,
            max_ticks: 50,
        },
    }
}

#[test]
fn replay_round_trips_through_json() {
    let (_, ticks, result) = scripted_match();
    let replay = Replay::record(header("red-ctrl", "blue-ctrl"), ticks, result);
    let json = replay.to_json();
    let back = Replay::from_json(&json).expect("the replay parses");
    assert_eq!(replay, back, "a replay round-trips through JSON");
    assert_eq!(
        replay.seed, "0xF02A44",
        "the seed is recorded as a 0x literal"
    );
}

#[test]
fn reconstruction_reproduces_the_recorded_result() {
    let (_, ticks, result) = scripted_match();
    let replay = Replay::record(header("r", "b"), ticks, result);
    // Reconstruct from the seed alone (the browser path) — it must reproduce the
    // committed result bit-for-bit and not drift.
    let game = replay
        .reconstruct()
        .expect("reconstruction reproduces the match");
    assert_eq!(
        game.result().map(crate::replay::ReplayResult::from),
        Some(replay.result)
    );
}

#[test]
fn reconstruction_detects_drift_against_a_tampered_result() {
    let (_, ticks, result) = scripted_match();
    let mut tampered = result;
    // Flip the recorded winner so the committed result no longer matches the
    // inputs; reconstruction must catch the disagreement.
    tampered.winner = Some(Team::Blue);
    tampered.score.blue = result.score.red + 100;
    let replay = Replay::record(header("r", "b"), ticks, tampered);
    let err = replay.reconstruct().expect_err("a tampered result drifts");
    assert!(
        matches!(err, ReplayError::Drift(_)),
        "the mismatch is reported as drift"
    );
}

#[test]
fn reconstruction_is_deterministic_across_runs() {
    let (_, ticks, result) = scripted_match();
    let replay = Replay::record(header("r", "b"), ticks, result);
    let a = replay.reconstruct().expect("first reconstruction");
    let b = replay.reconstruct().expect("second reconstruction");
    // Two independent reconstructions land on identical final state.
    assert_eq!(a.state.score, b.state.score);
    assert_eq!(a.state.agents, b.state.agents);
    assert_eq!(a.state.red_caches, b.state.red_caches);
    assert_eq!(a.state.blue_caches, b.state.blue_caches);
}
