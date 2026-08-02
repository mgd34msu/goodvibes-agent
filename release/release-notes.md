- **Fixed: conversations work again.** Versions 2.0.0 and 2.0.1 crashed on the first message of every conversation. The platform runtime still carried pre-split remnants that lazily imported in-process daemon composition code — code no product has used since the daemon became its own program — and bundling them fractured the packaged runtime's module initialization. The turn engine hit an uninitialized module, the error was swallowed, and the session froze at "awaiting response" with the turn lock held.
- Changed: the bundled GoodVibes platform runtime is 2.0.2, which deletes those remnants entirely. A client bundle can no longer reach daemon composition code, statically or dynamically, and a test pins that.
- Changed: the runtime barrel's operations exports are live re-exports from the platform runtime instead of eagerly-evaluated aliases — the same initialization-order hazard class, removed at the source.
- Changed: this release's gates run a real prompt through the built bundle and require a completed turn before anything ships. A booting binary is no longer accepted as proof of a working product.
- Changed: the daemon this Agent installs alongside itself is 1.28.4, carrying the same cleaned runtime.

GoodVibes Agent 2.0.2 - 2026-08-01
