import { describe, expect, test } from 'bun:test';
import { UIFactory } from '../../renderer/ui-factory.ts';
import { lineToString } from '../setup.ts';

describe('UIFactory', () => {
  test('header is branded as GoodVibes Agent', () => {
    const [header] = UIFactory.createHeader(80, 'gpt-test', 'test-provider');
    const text = lineToString(header ?? []);

    expect(text).toContain('GoodVibes Agent');
    expect(text).not.toContain('GoodVibes v');
  });
});
