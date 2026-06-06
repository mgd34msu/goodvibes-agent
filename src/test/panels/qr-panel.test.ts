import { describe, expect, mock, test } from 'bun:test';
import { QrPanel } from '../../panels/qr-panel.ts';
import { linesToText } from '../setup.ts';

describe('QrPanel', () => {
  test('shows connected-host auth guidance when token is missing', () => {
    const copied: string[] = [];
    const panel = new QrPanel({
      url: 'http://127.0.0.1:3421',
      token: '',
      username: 'admin',
      surface: 'goodvibes-agent',
    }, undefined, (text) => copied.push(text));

    const text = linesToText(panel.render(100, 18)).join('\n');

    expect(text).toContain('Pairing unavailable');
    expect(text).toContain('Use confirmed setup to create or repair it');
    expect(text).toContain('provision_connected_host_token');
    expect(text).toContain('host auth required');
    expect(text).not.toContain('copy token');

    expect(panel.handleInput('c')).toBe(true);
    expect(copied).toEqual([]);
  });

  test('does not regenerate tokens unless a connected-host callback is explicitly provided', () => {
    const regenerate = mock(() => ({
      url: 'http://127.0.0.1:3421',
      token: 'new-token',
      username: 'admin',
      surface: 'goodvibes-agent',
    }));
    const panel = new QrPanel({
      url: 'http://127.0.0.1:3421',
      token: 'existing-token',
      username: 'admin',
      surface: 'goodvibes-agent',
    });

    expect(panel.handleInput('r')).toBe(true);
    expect(regenerate).toHaveBeenCalledTimes(0);
  });
});
