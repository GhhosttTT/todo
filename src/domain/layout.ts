import type { LayoutMode } from '../types';

export const LAYOUT_DIMENSIONS: Record<LayoutMode, { width: number; height: number }> = {
  expanded: { width: 900, height: 620 },
  compact: { width: 400, height: 620 },
};

export function dimensionsForLayout(layoutMode: LayoutMode): { width: number; height: number } {
  return LAYOUT_DIMENSIONS[layoutMode];
}
