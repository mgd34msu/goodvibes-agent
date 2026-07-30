/**
 * agent-phone-tool.test.ts — the native `phone` tool.
 *
 * Drives the tool against a real device capability service (real grant store,
 * real capture store, stub node and stub transport) so the confirmation gate,
 * the durable-grant path, revocation, and the housekeeping disclosure are
 * exercised as behaviour rather than mocked away.
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  DeviceCapabilityService,
  DeviceCaptureArtifactStore,
  DeviceGrantStore,
  DeviceHousekeeper,
  DEVICE_CAPABILITY_CONTRACT_VERSION,
  DEVICE_CAPABILITY_IDS,
  resolveDeviceNodeProfile,
} from '@pellux/goodvibes-sdk/platform/devices';
import type {
  DeviceConfirmationDecision,
  DeviceConfirmationRequest,
  DeviceNodeProfile,
} from '@pellux/goodvibes-sdk/platform/devices';
import { createAgentPhoneTool } from '../../tools/agent-phone-tool.ts';
import { AGENT_DEVICE_ACTOR, type PhoneDeviceService } from '../../runtime/phone-device-service.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

let root = '';

beforeEach(() => {
  root = makeProjectTempDir('gv-agent-phone');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function nodeProfile(nodeId = 'node-a', nodeKind = 'web-pwa'): DeviceNodeProfile {
  const resolved = resolveDeviceNodeProfile({
    nodeId,
    nodeKind,
    label: `Phone ${nodeId}`,
    contractVersion: DEVICE_CAPABILITY_CONTRACT_VERSION,
    capabilities: [...DEVICE_CAPABILITY_IDS],
  });
  if (!resolved.ok) throw new Error('fixture node failed to resolve');
  return resolved.profile;
}

interface Fixture {
  readonly service: PhoneDeviceService;
  readonly prompts: DeviceConfirmationRequest[];
  setDecision(decision: DeviceConfirmationDecision): void;
  setBytes(bytes: Uint8Array | null): void;
}

function fixture(nodes: readonly DeviceNodeProfile[] = [nodeProfile()]): Fixture {
  const prompts: DeviceConfirmationRequest[] = [];
  let decision: DeviceConfirmationDecision = 'once';
  let bytes: Uint8Array | null = null;

  const grants = new DeviceGrantStore(join(root, 'device-grants.json'));
  const artifacts = new DeviceCaptureArtifactStore(join(root, 'captures'));
  const housekeeper = new DeviceHousekeeper({
    grants,
    artifacts,
    disclosurePath: join(root, 'device-housekeeping.json'),
  });
  const capabilities = new DeviceCapabilityService({
    grants,
    artifacts,
    dispatcher: {
      dispatch: async (input) => ({
        ok: true,
        data: { served: input.capabilityId },
        ...(bytes ? { bytes, mediaType: 'image/png' } : {}),
      }),
    },
    confirm: async (request) => {
      prompts.push(request);
      return { decision, actor: 'operator' };
    },
    listNodes: () => nodes,
  });

  const service: PhoneDeviceService = {
    capabilities,
    grants,
    artifacts,
    housekeeper,
    // The actor the ledger records for a revocation made through the tool, and
    // the posture read the tool renders for action:"capabilities".
    actor: AGENT_DEVICE_ACTOR,
    readPolicy: () => capabilities.getPolicy(),
    listNodes: () => nodes,
    startHousekeeping: async () => { await housekeeper.runRecoverySweep(); },
    stopHousekeeping: () => housekeeper.stop(),
  };

  return {
    service,
    prompts,
    setDecision(next) { decision = next; },
    setBytes(next) { bytes = next; },
  };
}

/**
 * The tool returns the runtime's ToolResult: `success` plus the full payload
 * serialised into `output`. Tests read the payload back so they assert on what
 * the model actually sees.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function toolParams(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function payloadOf(result: unknown): Record<string, unknown> {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const output = typeof record.output === 'string' ? record.output : '';
  if (!output) return record;
  return JSON.parse(output) as Record<string, unknown>;
}

describe('phone tool shape', () => {
  test('registers as a native tool named phone with the capability actions', () => {
    const tool = createAgentPhoneTool(fixture().service);
    expect(tool.definition.name).toBe('phone');
    const properties = asRecord(toolParams(tool.definition.parameters).properties);
    const actions = asRecord(properties.action).enum as string[];
    for (const action of ['photo', 'screenshot', 'location', 'clipboard_read', 'clipboard_write', 'notify', 'grants', 'revoke', 'housekeeping']) {
      expect(actions).toContain(action);
    }
  });

  test('the default action lists paired phones and what each offers', async () => {
    const tool = createAgentPhoneTool(fixture().service);
    const result = payloadOf(await tool.execute({}));
    expect(result.success).toBe(true);
    expect(result.paired).toBe(1);
    const nodes = result.nodes as Array<Record<string, unknown>>;
    expect(nodes[0]?.nodeId).toBe('node-a');
    expect((nodes[0]?.supported as string[]).length).toBeGreaterThan(0);
  });

  test('with no phone paired it says so instead of failing', async () => {
    const tool = createAgentPhoneTool(fixture([]).service);
    const result = payloadOf(await tool.execute({ action: 'nodes' }));
    expect(result.paired).toBe(0);
    expect(String(result.note)).toContain('No phone is paired');
  });

  test('the catalog states that every capability asks and offers "always allow"', async () => {
    const tool = createAgentPhoneTool(fixture().service);
    const result = payloadOf(await tool.execute({ action: 'capabilities' }));
    const capabilities = result.capabilities as Array<Record<string, unknown>>;
    expect(capabilities.length).toBeGreaterThan(0);
    for (const capability of capabilities) {
      expect(capability.allowAlwaysOffered).toBe(true);
      expect(String(capability.confirmation)).toContain('asks every time');
      expect(String(capability.purpose).length).toBeGreaterThan(20);
    }
  });
});

describe('capability requests', () => {
  test('a capture asks first and reports the retained artifact with its expiry', async () => {
    const f = fixture();
    f.setBytes(new Uint8Array([1, 2, 3]));
    const tool = createAgentPhoneTool(f.service);
    const result = payloadOf(await tool.execute({ action: 'photo', reason: 'read the label on this box' }));
    expect(result.success).toBe(true);
    expect(f.prompts.length).toBe(1);
    expect(f.prompts[0]?.allowAlwaysOffered).toBe(true);
    expect(result.authority).toBe('confirmed-once');
    const artifact = asRecord(result.artifact);
    expect(typeof artifact.expiresAt).toBe('string');
    expect(String(artifact.retentionNote)).toContain('Deleted automatically');
  });

  test('a request without a reason is refused before anyone is prompted', async () => {
    const f = fixture();
    const tool = createAgentPhoneTool(f.service);
    const result = payloadOf(await tool.execute({ action: 'screenshot' }));
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('reason is required');
    expect(f.prompts.length).toBe(0);
  });

  test('front camera and precise location are ordinary confirmed capabilities', async () => {
    const f = fixture();
    const tool = createAgentPhoneTool(f.service);
    await tool.execute({ action: 'photo', camera: 'front', reason: 'who is at the door' });
    await tool.execute({ action: 'location', precision: 'precise', reason: 'navigate home' });
    expect(f.prompts.map((prompt) => prompt.capabilityId)).toEqual([
      'device.camera.front.capture',
      'device.location.precise',
    ]);
    expect(f.prompts.every((prompt) => prompt.allowAlwaysOffered)).toBe(true);
  });

  test('clipboard read is in v1 and behaves like every other capability', async () => {
    const f = fixture();
    const tool = createAgentPhoneTool(f.service);
    const result = payloadOf(await tool.execute({ action: 'clipboard_read', reason: 'use what I just copied' }));
    expect(result.success).toBe(true);
    expect(f.prompts[0]?.capabilityId).toBe('device.clipboard.read');
    expect(f.prompts[0]?.allowAlwaysOffered).toBe(true);
  });

  test('a denial is reported honestly, not as a generic failure', async () => {
    const f = fixture();
    f.setDecision('deny');
    const tool = createAgentPhoneTool(f.service);
    const result = payloadOf(await tool.execute({ action: 'vibrate', reason: 'nudge me' }));
    expect(result.success).toBe(false);
    expect(result.refusal).toBe('denied-by-person');
  });

  test('a link that is not http(s) is refused before the device is involved', async () => {
    const f = fixture();
    const tool = createAgentPhoneTool(f.service);
    const result = payloadOf(await tool.execute({ action: 'open_url', url: 'file:///etc/hosts', reason: 'x' }));
    expect(result.success).toBe(false);
    expect(f.prompts.length).toBe(0);
  });

  test('with two phones offering the same capability the tool asks which one', async () => {
    const f = fixture([nodeProfile('node-a'), nodeProfile('node-b', 'android-native')]);
    const tool = createAgentPhoneTool(f.service);
    const result = payloadOf(await tool.execute({ action: 'screenshot', reason: 'x' }));
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('name one with nodeId');
    expect(String(result.hint)).toContain('node-b');
  });
});

describe('grants surface through the tool', () => {
  test('"always allow" produces a durable grant that the next request reuses', async () => {
    const f = fixture();
    f.setDecision('always');
    const tool = createAgentPhoneTool(f.service);
    await tool.execute({ action: 'screenshot', reason: 'read my screen' });

    const listed = payloadOf(await tool.execute({ action: 'grants' }));
    const grants = listed.grants as Array<Record<string, unknown>>;
    expect(grants.length).toBe(1);
    expect(grants[0]?.capabilityId).toBe('device.screen.capture');
    expect(grants[0]?.nodeId).toBe('node-a');

    f.setDecision('once');
    const second = payloadOf(await tool.execute({ action: 'screenshot', reason: 'again' }));
    expect(second.authority).toBe('existing-grant');
    expect(f.prompts.length).toBe(1);
  });

  test('revoking a grant makes the next request ask again', async () => {
    const f = fixture();
    f.setDecision('always');
    const tool = createAgentPhoneTool(f.service);
    await tool.execute({ action: 'clipboard_read', reason: 'x' });

    const revoked = payloadOf(await tool.execute({ action: 'revoke', capabilityId: 'device.clipboard.read' }));
    expect(revoked.revoked).toBe(1);
    expect(String(revoked.note)).toContain('deleted, not flagged');

    f.setDecision('once');
    const after = payloadOf(await tool.execute({ action: 'clipboard_read', reason: 'again' }));
    expect(after.authority).toBe('confirmed-once');
    expect(f.prompts.length).toBe(2);
  });

  test('revoke with no selector refuses rather than clearing everything', async () => {
    const f = fixture();
    f.setDecision('always');
    const tool = createAgentPhoneTool(f.service);
    await tool.execute({ action: 'vibrate', reason: 'x' });
    const result = payloadOf(await tool.execute({ action: 'revoke' }));
    expect(result.success).toBe(false);
    expect(((payloadOf(await tool.execute({ action: 'grants' })).grants) as unknown[]).length).toBe(1);
  });
});

describe('retention and housekeeping through the tool', () => {
  test('retained captures are listed with their expiry and the retention window', async () => {
    const f = fixture();
    f.setBytes(new Uint8Array([4, 5, 6, 7]));
    const tool = createAgentPhoneTool(f.service);
    await tool.execute({ action: 'photo', reason: 'x' });
    const result = payloadOf(await tool.execute({ action: 'artifacts' }));
    expect(result.retained).toBe(1);
    expect(result.retentionHours).toBe(24);
  });

  test('housekeeping reports its summary and what it removed', async () => {
    const f = fixture();
    const tool = createAgentPhoneTool(f.service);
    const result = payloadOf(await tool.execute({ action: 'housekeeping' }));
    expect(result.success).toBe(true);
    expect(String(result.summary)).toContain('Device housekeeping');
    expect(Array.isArray(result.grantsRemoved)).toBe(true);
    expect(Array.isArray(result.capturesRemoved)).toBe(true);
  });
});
