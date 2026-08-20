/**
 * The vocabulary shared by the engine's subsystems, by the game-facing API, and
 * by the host interface.
 *
 * These types are declared once, here, rather than beside the subsystem that owns
 * each one, because almost every one of them is spoken by more than one side of
 * the package. Keeping the declarations in a leaf module with no imports means the
 * entry points cannot drift apart, and that `@test-cabinet/simple-2d/host` can be
 * consumed for its types alone without pulling in the DOM-bound engine.
 */
export {};
//# sourceMappingURL=contract.js.map