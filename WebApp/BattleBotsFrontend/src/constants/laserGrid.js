/**
 * Laser grid geometry — single source of truth for beam positions and collision.
 * Matches the original flexbox layout: 3 beams centered with 18% gaps.
 */

export const FRAME_SIZE = 720;

/** Horizontal padding on each side (matches .laser-beams-container padding: 0 12px) */
export const LASER_PADDING_X = 12;

/** Beam height in px (matches .laser-beam height: 6px) */
export const LASER_BEAM_HEIGHT = 6;

/**
 * Y-center fractions of each beam (0–1 of arena height).
 * Derived from flexbox: center cluster with 18% gap between beams.
 */
export const LASER_BEAM_Y_FRACTIONS = [0.312, 0.5, 0.688];

/**
 * Danger band: rectangle spanning from top beam to bottom beam, full padded width.
 * top/bottom are the outer edges of the top/bottom beams (center ± half height).
 */
export const LASER_BAND = {
  top: LASER_BEAM_Y_FRACTIONS[0] - LASER_BEAM_HEIGHT / 2 / FRAME_SIZE,
  bottom: LASER_BEAM_Y_FRACTIONS[2] + LASER_BEAM_HEIGHT / 2 / FRAME_SIZE,
  left: LASER_PADDING_X / FRAME_SIZE,
  right: 1 - LASER_PADDING_X / FRAME_SIZE,
};

/** Approximate tank footprint radius on the 720×720 arena (half width/height). */
export const TANK_HIT_RADIUS_PX = 45;

function getLaserBandRect(frameSize = FRAME_SIZE) {
  return {
    top: LASER_BAND.top * frameSize,
    bottom: LASER_BAND.bottom * frameSize,
    left: LASER_BAND.left * frameSize,
    right: LASER_BAND.right * frameSize,
  };
}

function circleOverlapsRect(cx, cy, radius, rect) {
  const closestX = Math.max(rect.left, Math.min(cx, rect.right));
  const closestY = Math.max(rect.top, Math.min(cy, rect.bottom));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Returns true when the tank bot overlaps the laser beam zone.
 * Uses a circular hitbox so partial overlap counts (center need not be on a beam).
 */
export function isBotOverlappingLaserBand(
  x,
  y,
  hitRadius = TANK_HIT_RADIUS_PX,
  frameSize = FRAME_SIZE
) {
  if (x == null || y == null || Number.isNaN(x) || Number.isNaN(y)) {
    return false;
  }

  return circleOverlapsRect(x, y, hitRadius, getLaserBandRect(frameSize));
}

/**
 * Returns true when a point (in 720×720 arena coordinates) is inside the laser band.
 */
export function isPointInLaserBand(x, y, frameSize = FRAME_SIZE) {
  return isBotOverlappingLaserBand(x, y, 0, frameSize);
}
