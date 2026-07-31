import { type Line } from '@pellux/goodvibes-sdk/platform/types';
import { BORDERS } from './layout.ts';
import { renderConversationNotice } from './conversation-surface.ts';
import { activeUiTones } from './theme.ts';

export function renderThinkingBlock(text: string, width: number): Line[] {
  // Thinking notices paint the ▌ marker and italic body on the TRANSPARENT
  // terminal background (renderConversationNotice passes no bodyBg), so both
  // colours resolve per-render through activeUiTones() to stay legible on a
  // light terminal. In dark mode the accent adopts the shared reasoning purple
  // (state.reasoning) and the body adopts chrome.faint (== fg.dim) — a small,
  // deliberate convergence to the reference tokens from the agent's prior local
  // BORDERS.THINKING.color / COLORS.DIM_TEXT (see the visible-changes note).
  const t = activeUiTones();
  return renderConversationNotice(
    text,
    width,
    {
      accent: t.state.reasoning,
      text: t.chrome.faint,
      dim: true,
      italic: true,
    },
    BORDERS.THINKING.char,
  );
}
