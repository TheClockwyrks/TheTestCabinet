/**
 * The vocabulary shared by the engine's subsystems and by its host interface.
 *
 * These types are declared once, here, rather than beside the subsystem that owns
 * each one, because almost every one of them is spoken by *both* sides of the
 * package: the game-facing API (`createEngine`) accepts them, and the host
 * interface (`window.__tcabEngine`, the `./host` export) returns them to a driver.
 * Keeping the declarations in a leaf module with no imports means the two entry
 * points cannot drift apart, and that `./host` can be consumed for its types alone
 * — by a validation script or a driver — without pulling in the engine
 * implementation.
 *
 * Everything here is data: plain structural types, no classes and no behaviour, so
 * a value crossing the `window` boundary into a driver survives structured cloning
 * and JSON serialization unchanged.
 */
export {};
