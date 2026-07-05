// src/ui/segmented.ts — shared segmented-control styling (#194 component kit,
// section 1d "Segmented control").
//
// Kit spec: track #eef1f5, padding 3px, radius 9; segments radius 7, active
// #0d3e7a/white, idle transparent/#8792a0.
//
// The allocation chart view toggle (AllocationViews.tsx) already renders exactly
// this control, so these constants are extracted from it verbatim. Later stages
// reuse them for the Import source picker (3b) and any other segmented control,
// keeping one source of truth. Kept as inline-style objects (not Tailwind
// classes) because the existing toggle uses inline styles and its tests read
// them that way — extraction here is behaviour-preserving.

import type { CSSProperties } from 'react';

/** The pill "track" that wraps the segments. */
export const segmentedTrackStyle: CSSProperties = {
  display: 'inline-flex',
  background: '#eef1f5', // tint-cell
  padding: 3,
  borderRadius: 9,
  gap: 2,
};

/**
 * A single segment's style. Pass whether it's the active segment.
 * Active: brand fill, white text. Idle: transparent, muted-2 text.
 */
export function segmentStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 0,
    padding: '7px 14px',
    border: 'none',
    cursor: 'pointer',
    borderRadius: 7,
    transition: 'all .12s',
    background: active ? '#0d3e7a' : 'transparent', // brand-600 / transparent
    color: active ? '#fff' : '#8792a0', // white / muted-2
  };
}
