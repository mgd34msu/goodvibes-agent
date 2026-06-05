import type { InputHandler } from '../input/handler.ts';
import type { CompositeRequest } from '../renderer/compositor.ts';
import { renderModelWorkspace } from '../renderer/model-workspace.ts';
import { renderOnboardingWizard } from '../renderer/onboarding/onboarding-wizard.ts';
import { type Line, createEmptyLine } from '../types/grid.ts';

function normalizeFullscreenViewport(lines: readonly Line[], width: number, height: number): Line[] {
  const viewport = lines.slice(0, height).map((line) => {
    if (line.length === width) return line;
    const next = createEmptyLine(width);
    for (let index = 0; index < Math.min(width, line.length); index += 1) {
      next[index] = { ...line[index]! };
    }
    return next;
  });
  while (viewport.length < height) viewport.push(createEmptyLine(width));
  return viewport;
}

export function createOnboardingFullscreenComposite(
  input: InputHandler,
  width: number,
  height: number,
): CompositeRequest {
  const viewport = normalizeFullscreenViewport(
    input.modelPicker.active
      ? renderModelWorkspace(input.modelPicker, width, height)
      : renderOnboardingWizard(input.onboardingWizard, width, height),
    width,
    height,
  );
  return {
    width,
    height,
    header: [],
    viewport,
    footer: [],
    forceFullRedraw: true,
    panelWidth: 0,
  };
}
