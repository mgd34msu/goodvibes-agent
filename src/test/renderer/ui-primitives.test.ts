import { describe, expect, test } from 'bun:test';
import { GLYPHS } from '../../renderer/ui-primitives.ts';
import { STATE_GLYPHS } from '../../renderer/status-glyphs.ts';
import { buildMeterLine, buildSectionHeader } from '../../renderer/polish.ts';
import { lineToString } from '../setup.ts';

describe('ui primitives', () => {
  test('exports canonical unicode glyphs for shared UI layers', () => {
    expect(GLYPHS.frame.topLeft).toBe('┌');
    expect(GLYPHS.frame.vertical).toBe('│');
    expect(GLYPHS.surface.top).toBe('▄');
    expect(GLYPHS.surface.bottom).toBe('▀');
    expect(GLYPHS.surface.cursor).toBe('█');
    expect(GLYPHS.navigation.selected).toBe('▸');
    expect(GLYPHS.navigation.collapsed).toBe('▸');
    expect(GLYPHS.navigation.expanded).toBe('▾');
    expect(GLYPHS.status.success).toBe('✓');
    expect(GLYPHS.status.pending).toBe('•');
    expect(GLYPHS.meter.filled).toBe('█');
    expect(GLYPHS.meter.empty).toBe('░');
  });

  // The status glyphs converge on the TUI reference via the SDK
  // presentation contract. idle ○ -> ◌, info • -> ○, and a new warn ⚠ key —
  // a deliberate, visible convergence (per S1's divergence ruling), asserted
  // here so a future drift is caught.
  test('status glyphs adopt the reconciled TUI-reference definitions', () => {
    expect(GLYPHS.status.idle).toBe('◌');   // U+25CC (was ○ in the agent)
    expect(GLYPHS.status.info).toBe('○');    // U+25CB (was • in the agent)
    expect(GLYPHS.status.warn).toBe('⚠');    // new key (absent in the agent)
    expect(GLYPHS.status.failure).toBe('✕');
  });

  test('STATE_GLYPHS aliases GLYPHS.status (single source, no independent literals)', () => {
    expect(STATE_GLYPHS.good).toBe(GLYPHS.status.success);
    expect(STATE_GLYPHS.warn).toBe(GLYPHS.status.warn);
    expect(STATE_GLYPHS.bad).toBe(GLYPHS.status.failure);
    expect(STATE_GLYPHS.info).toBe(GLYPHS.status.info);
  });

  test('section headers use box-drawing horizontal dividers', () => {
    const line = buildSectionHeader(40, 'Summary', {
      label: '#94a3b8',
      value: '#e2e8f0',
      dim: '#475569',
      info: '#38bdf8',
      good: '#22c55e',
      warn: '#f59e0b',
      bad: '#ef4444',
      empty: '#334155',
      header: '#e2e8f0',
      headerBg: '#0f172a',
      accent: '#cbd5e1',
      selectBg: '#111827',
    });
    expect(lineToString(line)).toContain('Summary');
    expect(lineToString(line)).toContain('─');
  });

  test('meter lines default to block and shade glyphs', () => {
    const line = buildMeterLine(24, 4, 8, { filled: '#22c55e', empty: '#334155' });
    const text = lineToString(line);
    expect(text).toContain('█');
    expect(text).toContain('░');
  });
});
