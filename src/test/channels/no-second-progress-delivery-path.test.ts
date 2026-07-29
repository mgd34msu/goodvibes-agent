/**
 * no-second-progress-delivery-path.test.ts — the machine's tool trace does not
 * become a chat message, and this product cannot start doing it again by
 * growing its own copy of the delivery path.
 *
 * Background: internal tool-registry diagnostics ("registry — email send",
 * "exec — standard", "find") were delivered to a chat channel as if they were
 * things a person had asked to read. The repair is entirely in the SDK
 * (platform/agents/progress-audience.ts, platform/channels/render-audience.ts,
 * and a gate at the top of eventLine). This product carries no copy of any of
 * it — the assertions below are what keeps that true, because the failure would
 * come back the same way it arrived: a helper pasted locally, out of reach of
 * the SDK's gate.
 *
 * What this product DOES do with agent progress is render it where a person is
 * already looking at this terminal — the activity sidebar and the delegated-task
 * status line — and hand it to the model as tool output. Those are local
 * surfaces, not deliveries, and the tests below hold that line by asserting the
 * channel-send path never reaches for a progress field.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

/** Symbols that belong to the SDK's delivery/render path and nowhere else. */
const SDK_OWNED_DELIVERY_SYMBOLS: readonly string[] = [
  'deliverProgress',
  'ChannelRenderEvent',
  'channelStatusLine',
  'summarizeToolArgs',
  'progress-audience',
  'render-audience',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(abs));
      continue;
    }
    if (entry.isFile() && abs.endsWith('.ts')) out.push(abs);
  }
  return out;
}

function isTestSource(path: string): boolean {
  return path.includes('/src/test/') || path.endsWith('.test.ts') || path.includes('/__tests__/');
}

const productionFiles = walk(SRC_ROOT).filter((file) => !isTestSource(file) && statSync(file).isFile());

describe('the tool-activity delivery path has exactly one home, and it is the SDK', () => {
  for (const symbol of SDK_OWNED_DELIVERY_SYMBOLS) {
    test(`no production file defines or re-implements ${symbol}`, () => {
      const offenders = productionFiles.filter((file) => readFileSync(file, 'utf-8').includes(symbol));
      expect(offenders.map((file) => relative(REPO_ROOT, file))).toEqual([]);
    });
  }

  test('the channel send path never reads an agent record progress field', () => {
    // deliverAgentChannelMessage is the single outbound funnel in this product
    // (agent/channel-delivery.ts). A progress read appearing in it would be the
    // start of the same defect, in this repo this time.
    const deliveryPath = join(SRC_ROOT, 'agent', 'channel-delivery.ts');
    const source = readFileSync(deliveryPath, 'utf-8');
    expect(source).not.toContain('.progress');
    expect(source).not.toContain('latestProgress');
    expect(source).not.toContain('toolCallCount');
  });

  test('agent progress is rendered only by local terminal surfaces and tool output', () => {
    // A census rather than a ban: progress SHOULD be visible where the operator
    // is already looking. This fails when a new reader appears, so somebody has
    // to decide whether the new one is a local surface or a delivery.
    const readers = productionFiles
      .filter((file) => {
        const source = readFileSync(file, 'utf-8');
        return source.includes('agent.progress')
          || source.includes('record.progress')
          || source.includes('latestProgress');
      })
      .map((file) => relative(REPO_ROOT, file))
      .sort();

    expect(readers).toEqual([
      // ── This terminal's own frame. Drawn where the operator is already
      //    looking; nothing leaves the machine.
      'src/renderer/activity-sidebar.ts', // the live activity list
      'src/runtime/agent-runtime-events.ts', // the periodic delegated-task line
      'src/main.ts', // the footer's running-agent indicator
      // ── Tool output: the model's own view of work it delegated, returned to
      //    it as a tool result rather than sent to a person.
      'src/tools/agent-harness-agent-orchestration.ts',
      // ── A research run's completion PERCENTAGE, which is a different field
      //    that shares the name: a number the operator asked for, not a trace
      //    of which tool the machine reached for.
      'src/tools/agent-harness-autonomy-queue.ts',
      'src/tools/agent-harness-research-live-read-models.ts',
    ].sort());
  });
});
