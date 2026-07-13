/**
 * Spawn-routing model-reference contract.
 *
 * The shared-session continuation runner (src/runtime/services.ts) builds
 * agent spawn options through buildAgentSpawnRoutingFromSharedSession, whose
 * bare-id resolution is the SDK's public resolveModelReference contract:
 *   - provider-qualified ids pass through unchanged,
 *   - a provider-qualified id conflicting with the provider hint throws,
 *   - a bare id with a provider hint qualifies to that provider,
 *   - a bare id unique across the registry auto-qualifies,
 *   - an ambiguous bare id throws the real candidate registryKeys,
 *   - an unknown bare id throws closest-match suggestions plus an example,
 *   - without registry candidates a bare id throws (never a silent guess).
 */
import { describe, expect, test } from 'bun:test';
import { buildAgentSpawnRoutingFromSharedSession } from '../../runtime/services.ts';
import { buildTestModelDefinition } from '../helpers/test-managers.ts';

// The live caller passes providerRegistry.listModels() (ModelDefinition[]);
// these fixtures use the same shape so the test proves that feed works.
const candidates = [
  buildTestModelDefinition('alpha', 'compact-1'),
  buildTestModelDefinition('alpha', 'shared-model'),
  buildTestModelDefinition('beta', 'shared-model'),
  buildTestModelDefinition('beta', 'deep-9'),
];

describe('spawn routing model-reference contract', () => {
  test('a bare id unique across the registry auto-qualifies to its registryKey', () => {
    const spawn = buildAgentSpawnRoutingFromSharedSession(
      { modelId: 'compact-1' },
      { modelCandidates: candidates },
    );
    expect(spawn.model).toBe('alpha:compact-1');
  });

  test('an ambiguous bare id throws the real candidate registryKeys', () => {
    expect(() => buildAgentSpawnRoutingFromSharedSession(
      { modelId: 'shared-model' },
      { modelCandidates: candidates },
    )).toThrow(/ambiguous.*alpha:shared-model, beta:shared-model/);
  });

  test('an unknown bare id throws closest-match suggestions and a concrete example', () => {
    let message = '';
    try {
      buildAgentSpawnRoutingFromSharedSession(
        { modelId: 'compakt-1' },
        { modelCandidates: candidates },
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("Unknown model 'compakt-1'");
    expect(message).toContain('Did you mean');
    expect(message).toContain('alpha:compact-1');
    expect(message).toContain('Example of a valid model reference');
  });

  test('a bare id with a provider hint qualifies to that provider', () => {
    const spawn = buildAgentSpawnRoutingFromSharedSession(
      { providerId: 'beta', modelId: 'shared-model' },
      { modelCandidates: candidates },
    );
    expect(spawn.model).toBe('beta:shared-model');
    expect(spawn.provider).toBe('beta');
  });

  test('a provider-qualified id passes through unchanged', () => {
    const spawn = buildAgentSpawnRoutingFromSharedSession(
      { modelId: 'beta:deep-9' },
      { modelCandidates: candidates },
    );
    expect(spawn.model).toBe('beta:deep-9');
  });

  test('a provider-qualified id conflicting with the provider hint throws', () => {
    expect(() => buildAgentSpawnRoutingFromSharedSession(
      { providerId: 'alpha', modelId: 'beta:deep-9' },
      { modelCandidates: candidates },
    )).toThrow(/conflicts with provider 'alpha'/);
  });

  test('a bare id without registry candidates throws instead of guessing', () => {
    expect(() => buildAgentSpawnRoutingFromSharedSession(
      { modelId: 'compact-1' },
    )).toThrow(/must be provider-qualified/);
  });

  test('bare fallback models resolve through the registry too', () => {
    const spawn = buildAgentSpawnRoutingFromSharedSession(
      { modelId: 'compact-1', providerFailurePolicy: 'ordered-fallbacks', fallbackModels: ['deep-9'] },
      { modelCandidates: candidates },
    );
    expect(spawn.routing?.fallbackModels).toEqual(['beta:deep-9']);
  });

  test('an ambiguous bare fallback model throws the candidate registryKeys', () => {
    expect(() => buildAgentSpawnRoutingFromSharedSession(
      { modelId: 'compact-1', providerFailurePolicy: 'ordered-fallbacks', fallbackModels: ['shared-model'] },
      { modelCandidates: candidates },
    )).toThrow(/Shared-session fallback model:.*ambiguous/);
  });
});
