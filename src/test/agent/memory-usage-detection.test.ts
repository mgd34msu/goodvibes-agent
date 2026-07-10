import { describe, it, expect } from 'bun:test';
import { detectReferencedMemoryIds } from '@pellux/goodvibes-sdk/platform/state';

describe('detectReferencedMemoryIds', () => {
  it('flags a memory as referenced when the output overlaps its distinctive tokens', () => {
    const records = [{ id: 'm1', summary: 'Deployment uses the Kubernetes rollout script', detail: 'canary rollout' }];
    const result = detectReferencedMemoryIds('I ran the kubernetes rollout as configured.', records);
    expect(result.referenced).toEqual(['m1']);
    expect(result.perId.get('m1')).toBe('referenced');
  });

  it('marks a memory present when the output shares only common words', () => {
    const records = [{ id: 'm2', summary: 'The user prefers concise summaries' }];
    const result = detectReferencedMemoryIds('Here is the answer you asked for.', records);
    expect(result.present).toEqual(['m2']);
    expect(result.referenced).toHaveLength(0);
  });

  it('requires two distinctive tokens or one long distinctive token', () => {
    const single = detectReferencedMemoryIds('talk about tags here', [{ id: 'm3', summary: 'tags summary line' }]);
    // "tags" is only 4 chars and the single overlap -> present.
    expect(single.perId.get('m3')).toBe('present');
    const long = detectReferencedMemoryIds('discuss authentication', [{ id: 'm4', summary: 'authentication flow reminder' }]);
    // "authentication" is >=6 chars, single long overlap -> referenced.
    expect(long.perId.get('m4')).toBe('referenced');
  });

  it('detects a distinctive adjacent phrase in the output', () => {
    const records = [{ id: 'm5', summary: 'release checklist ordering', detail: 'follow release checklist' }];
    const result = detectReferencedMemoryIds('Remember to follow the release checklist before shipping.', records);
    expect(result.referenced).toContain('m5');
  });
});
