/**
 * render-binding-hoisted.test.ts
 *
 * Every agent boot in the crash window logged:
 *
 *   ReferenceError: Cannot access 'render' before initialization
 *
 * as an UNHANDLED REJECTION. `render` was `const render = () => {…}` roughly
 * three hundred lines below the wiring that captures it, and
 * `bindApprovalsPanel()` calls `approvalsView.start()`, which fires an
 * unawaited `refresh()` and an unawaited `openStream()`. When either resolved
 * before the declaration was reached, its repaint hit the temporal dead zone.
 *
 * The throw landed in a floating promise, so it did not crash the process, it
 * killed that wiring silently, and the surface then never repainted from any
 * async source for the life of the process. That is the same blindness the
 * hosted-turn work was chasing, arriving by a second route.
 *
 * The fix is that `render` is a hoisted FUNCTION DECLARATION, initialized
 * before any statement in its scope runs, so every early consumer is correct by
 * construction rather than by remembering to defer. These tests pin the
 * property rather than the prose: the source must not reintroduce the `const`,
 * and the hazard pattern itself must behave as described.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAIN = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf-8');

describe('the shell render binding cannot be reached before it exists', () => {
  test('render is a hoisted function declaration, not a const arrow', () => {
    expect(MAIN).toContain('function render(): void {');
    // The exact form that produced the boot-time ReferenceError.
    expect(MAIN).not.toContain('const render = () => {');
  });

  test('the wiring that starts unawaited work still precedes the declaration', () => {
    // If this ever stops being true the hazard is gone for a different reason,
    // and this file should be revisited rather than silently kept passing.
    const bindIndex = MAIN.indexOf('bindApprovalsPanel({');
    const declIndex = MAIN.indexOf('function render(): void {');
    expect(bindIndex).toBeGreaterThan(-1);
    expect(declIndex).toBeGreaterThan(-1);
    expect(bindIndex).toBeLessThan(declIndex);
  });

  test('a hoisted declaration is reachable from a closure defined above it', () => {
    // The language property the fix rests on, shown rather than asserted. The
    // `const` form throws here; the declaration does not, which is why every
    // early consumer becomes correct without each one remembering to defer.
    const callEarly = (): string => paint();
    function paint(): string { return 'painted'; }
    expect(callEarly()).toBe('painted');
  });

  test('the const form throws exactly the ReferenceError the boot logged', () => {
    // Pinned so the message in this file's header stays verifiable rather than
    // becoming folklore about a fault nobody can demonstrate any more.
    const reachEarly = (): unknown => {
      const attempt = (): string => painter();
      const result = attempt();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const painter = (): string => 'painted';
      return result;
    };
    expect(reachEarly).toThrow(/before initialization/);
  });
});
