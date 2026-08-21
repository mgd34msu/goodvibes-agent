/**
 * agent-phone-tool.test.ts, the agent's end of the paired-phone split.
 *
 * ── What this file used to pin, and why that could not stay ───────────────
 *
 * It drove this repo's own `phone` tool over this repo's own device-posture
 * runtime: a second grants ledger, a second capture store, a second set of
 * housekeeping sweeps, living in the agent process and writing the same files
 * the daemon writes. Both are gone. A phone pairs with the daemon, a grant has
 * to outlive the terminal window that approved it, and the sweep that reaps a
 * grant whose phone is gone has to run with nobody watching.
 *
 * ── What it pins now ──────────────────────────────────────────────────────
 *
 * The TOOL still lives here, because the loop that calls it does. So the
 * agent's end of the contract is exactly this: every capability, every grant
 * read, every revoke and every sweep leaves this process as a `devices.*` verb,
 * and nothing is re-decided on the way out.
 *
 * That is the assertion with teeth. A regression here would not look like a
 * crash, it would look like the agent quietly answering from a local store
 * again, which is exactly what this suite exists to prevent.
 *
 * The refusal-vs-error line is the other half, and it is behavioural: someone
 * declining their camera is the system WORKING, so it comes back as a
 * SUCCESSFUL tool result carrying `allowed: false`. Returned as a tool error, a
 * model reads it as something to retry and the person is prompted again for the
 * thing they just declined.
 *
 * The `device.*` settings themselves, which capabilities are offered, how
 * authority is established, how long a capture is retained, belong to the
 * daemon's runtime, and are verified against that runtime in
 * device-settings-behavior.test.ts beside this file.
 */
import { describe, expect, test } from 'bun:test';
import { createDevicesClient, registerClientPhoneTool } from '@pellux/goodvibes-sdk/platform/runtime/client';
import type { DaemonReachability, DaemonVerbCaller } from '@pellux/goodvibes-sdk/platform/runtime/client';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';

interface RecordedCall {
  readonly methodId: string;
  readonly input: unknown;
}

/** A verb caller that records every call and answers from a scripted table. */
function stubVerbs(options: {
  readonly reachable?: boolean;
  readonly answers?: Record<string, unknown>;
  readonly calls: RecordedCall[];
}): DaemonVerbCaller {
  const reachable = options.reachable !== false;
  return {
    probe(): DaemonReachability {
      return reachable
        ? { available: true }
        : { available: false, reason: 'no connected host is configured on this machine.' };
    },
    invoke: async <T,>(methodId: string, input?: unknown): Promise<T> => {
      options.calls.push({ methodId, input });
      if (!reachable) throw new Error(`cannot invoke '${methodId}': no connected host is configured on this machine.`);
      const answers = options.answers ?? {};
      if (!(methodId in answers)) throw new Error(`the stub was not scripted for '${methodId}'`);
      return answers[methodId] as T;
    },
  };
}

function registerPhone(verbs: DaemonVerbCaller): Tool {
  const registry = new ToolRegistry();
  registerClientPhoneTool(registry, createDevicesClient(verbs));
  const tool = registry.list().find((candidate) => candidate.definition.name === 'phone');
  if (!tool) throw new Error('the client phone tool was not registered');
  return tool;
}

/** The tool returns `{ success, output }`; tests read what the model sees. */
function payloadOf(result: unknown): Record<string, unknown> {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const output = typeof record['output'] === 'string' ? record['output'] : '';
  if (!output) return record;
  return JSON.parse(output) as Record<string, unknown>;
}

function succeeded(result: unknown): boolean {
  return (result as { success?: unknown } | null)?.success === true;
}

describe('the phone tool is registered in this process', () => {
  test('it registers as a native tool named phone with the capability actions', () => {
    const tool = registerPhone(stubVerbs({ calls: [] }));
    expect(tool.definition.name).toBe('phone');
    const properties = (tool.definition.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    const actions = (properties['action'] as { enum?: string[] }).enum ?? [];
    for (const action of ['photo', 'screenshot', 'location', 'clipboard_read', 'clipboard_write', 'notify', 'grants', 'revoke', 'housekeeping']) {
      expect(actions).toContain(action);
    }
  });
});

describe('every device action leaves this process as a devices.* verb', () => {
  test('listing paired phones is devices.nodes.list, not a local store read', async () => {
    const calls: RecordedCall[] = [];
    const tool = registerPhone(stubVerbs({
      calls,
      answers: {
        'devices.nodes.list': {
          nodes: [{ nodeId: 'node-a', label: 'Pixel', platform: 'android', supported: ['device.camera.rear.capture'] }],
        },
      },
    }));

    const result = await tool.execute({ action: 'nodes' });
    const payload = payloadOf(result);

    expect(succeeded(result)).toBe(true);
    expect(calls.map((call) => call.methodId)).toEqual(['devices.nodes.list']);
    expect(payload['paired']).toBe(1);
    expect((payload['nodes'] as Array<Record<string, unknown>>)[0]?.['nodeId']).toBe('node-a');
  });

  test('a capability request is devices.capability.request, carrying the reason verbatim', async () => {
    const calls: RecordedCall[] = [];
    const tool = registerPhone(stubVerbs({
      calls,
      answers: {
        'devices.nodes.list': { nodes: [{ nodeId: 'node-a', supported: ['device.camera.rear.capture'] }] },
        'devices.capability.request': {
          ok: true,
          nodeId: 'node-a',
          capabilityId: 'device.camera.rear.capture',
          capabilityTitle: 'Rear camera photo',
          authority: 'confirmed',
          artifact: { artifactId: 'artifact-1', mediaType: 'image/png', byteLength: 12 },
        },
      },
    }));

    const result = await tool.execute({ action: 'photo', nodeId: 'node-a', reason: 'check whether the oven is off' });

    expect(succeeded(result)).toBe(true);
    const request = calls.find((call) => call.methodId === 'devices.capability.request');
    expect(request).toBeTruthy();
    // The reason the person reads is the reason the caller gave. A tool that
    // rewrote it would be putting words in front of a confirmation prompt.
    expect((request!.input as { reason: string }).reason).toBe('check whether the oven is off');
    expect((request!.input as { nodeId: string }).nodeId).toBe('node-a');
  });

  test('grants are read over devices.grants.list and revoked over devices.grants.revoke', async () => {
    const calls: RecordedCall[] = [];
    const tool = registerPhone(stubVerbs({
      calls,
      answers: {
        'devices.grants.list': {
          grants: [{ grantId: 'grant-1', nodeId: 'node-a', capability: 'device.camera.rear.capture' }],
        },
        'devices.grants.revoke': { ok: true },
      },
    }));

    expect(succeeded(await tool.execute({ action: 'grants' }))).toBe(true);
    expect(succeeded(await tool.execute({ action: 'revoke', grantId: 'grant-1' }))).toBe(true);

    expect(calls.map((call) => call.methodId)).toEqual(['devices.grants.list', 'devices.grants.revoke']);
    const revoke = calls.find((call) => call.methodId === 'devices.grants.revoke');
    expect((revoke!.input as { grantId: string }).grantId).toBe('grant-1');
  });

  test('housekeeping is devices.housekeeping.run — no sweep runs in this process', async () => {
    const calls: RecordedCall[] = [];
    const tool = registerPhone(stubVerbs({
      calls,
      answers: { 'devices.housekeeping.run': { grantsRemoved: 2, artifactsRemoved: 1 } },
    }));

    const result = await tool.execute({ action: 'housekeeping' });

    expect(succeeded(result)).toBe(true);
    expect(calls.map((call) => call.methodId)).toEqual(['devices.housekeeping.run']);
    expect(payloadOf(result)['grantsRemoved']).toBe(2);
  });

  test('retained captures are listed over devices.artifacts.list, never off local disk', async () => {
    const calls: RecordedCall[] = [];
    const tool = registerPhone(stubVerbs({
      calls,
      answers: {
        'devices.artifacts.list': {
          artifacts: [{ artifactId: 'artifact-1', nodeId: 'node-a', mediaType: 'image/png', byteLength: 12 }],
          retained: 1,
          retentionHours: 24,
        },
      },
    }));

    const result = await tool.execute({ action: 'artifacts' });

    expect(succeeded(result)).toBe(true);
    expect(calls.map((call) => call.methodId)).toEqual(['devices.artifacts.list']);
    expect(payloadOf(result)['retentionHours']).toBe(24);
  });
});

describe('a refusal is an answer; an unreachable host is a failure', () => {
  test('a declined capability is a SUCCESSFUL result carrying allowed: false', async () => {
    const calls: RecordedCall[] = [];
    const tool = registerPhone(stubVerbs({
      calls,
      answers: {
        'devices.nodes.list': { nodes: [{ nodeId: 'node-a', supported: ['device.camera.rear.capture'] }] },
        'devices.capability.request': {
          ok: false,
          nodeId: 'node-a',
          capabilityId: 'device.camera.rear.capture',
          refusal: 'declined-by-person',
          detail: 'not right now',
        },
      },
    }));

    const result = await tool.execute({ action: 'photo', nodeId: 'node-a', reason: 'check the oven' });
    const payload = payloadOf(result);

    // The important line in this file. A model reads a failed tool call as
    // something to retry, so returning a decline as an error prompts the person
    // again for the thing they just declined.
    expect(succeeded(result)).toBe(true);
    expect(payload['allowed']).toBe(false);
    expect(payload['refusal']).toBe('declined-by-person');
    expect(payload['detail']).toBe('not right now');
  });

  test('with no reachable host a capability request FAILS rather than answering empty', async () => {
    const calls: RecordedCall[] = [];
    const verbs = stubVerbs({ calls, reachable: false });
    const tool = registerPhone(verbs);

    const result = await tool.execute({ action: 'photo', nodeId: 'node-a', reason: 'check the oven' });

    // Reporting a capture that did not happen is worse than reporting the
    // failure, so nothing here invents an empty success. The tool refuses at
    // the first honest wall it meets, with no host it cannot even confirm the
    // phone exists, so the message names THAT rather than a capture outcome.
    expect(succeeded(result)).toBe(false);
    expect(String((result as { error?: unknown }).error)).not.toContain('artifact');

    // And the seam underneath refuses for the reason a person needs to read.
    await expect(createDevicesClient(verbs).requestCapability({
      nodeId: 'node-a',
      capabilityId: 'device.camera.rear.capture',
      reason: 'check the oven',
    })).rejects.toThrow(/no connected host/);
  });

  test('with no reachable host a revoke FAILS rather than reporting a revocation', async () => {
    const calls: RecordedCall[] = [];
    const tool = registerPhone(stubVerbs({ calls, reachable: false }));

    const result = await tool.execute({ action: 'revoke', grantId: 'grant-1' });

    expect(succeeded(result)).toBe(false);
  });

  test('with no reachable host a LIST says so instead of implying no phone is paired', async () => {
    const calls: RecordedCall[] = [];
    const verbs = stubVerbs({ calls, reachable: false });
    const tool = registerPhone(verbs);

    const result = await tool.execute({ action: 'nodes' });

    // An empty list and an unreachable host look identical as a number. The
    // honest reason has to reach the model, or "no phone is paired" is a lie.
    expect(succeeded(result)).toBe(false);
    expect(String(payloadOf(result)['error'])).toContain('no connected host');
    expect(createDevicesClient(verbs).describeAvailability()).toContain('no connected host');
  });
});
