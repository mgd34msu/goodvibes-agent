/**
 * permission-card.ts, test helper: the permission approval card's rows.
 *
 * The card is a surface-kit modal (PermissionPromptUI.createPromptLayer). Tests
 * that only care about what the card says read its rows directly, drawn on a
 * screen of the given width and a height tall enough for every fact row.
 */

import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import { PermissionPromptUI, type PermissionRequest } from '../../permissions/prompt.ts';

/** The card's rows (the modal layer's own lines) for a screen `width` columns wide. */
export function promptCardLines(width: number, request: PermissionRequest, height = 60): Line[] {
  return PermissionPromptUI.createPromptLayer(width, height, request).lines;
}

/** The card's text, one row per line. */
export function promptCardText(width: number, request: PermissionRequest, height = 60): string {
  return promptCardLines(width, request, height).map((line) => line.map((cell) => cell.char).join('')).join('\n');
}
