import type { LayoutMode } from '../types';

export const DEFAULT_LAYOUT_DIMENSIONS: Record<LayoutMode, { width: number; height: number }> = {
  expanded: { width: 900, height: 620 },
  compact: { width: 400, height: 620 },
};

export const MIN_LAYOUT_DIMENSIONS: Record<LayoutMode, { width: number; height: number }> = {
  expanded: { width: 720, height: 460 },
  compact: { width: 360, height: 480 },
};

export const LAYOUT_DIMENSIONS = DEFAULT_LAYOUT_DIMENSIONS;

export function dimensionsForLayout(layoutMode: LayoutMode): { width: number; height: number } {
  return DEFAULT_LAYOUT_DIMENSIONS[layoutMode];
}

export function minDimensionsForLayout(layoutMode: LayoutMode): { width: number; height: number } {
  return MIN_LAYOUT_DIMENSIONS[layoutMode];
}
