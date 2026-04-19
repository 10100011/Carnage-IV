import { HITBOX, STROKE } from './config';

/** Plane life-cycle states. §8.2 / §8.4 / §11. */
export type PlaneState = 'grounded' | 'airborne' | 'stalled';

/**
 * Plane entity.
 *
 * - Position is the centre of the circular hitbox (§9.7), in logical units.
 * - Heading follows §8.1: `0` = straight up, `π/2` = right, `π` = down,
 *   `3π/2` = left. Clockwise increases. This convention matches canvas 2D's
 *   `ctx.rotate` direction, so rendering is a direct translate + rotate.
 */
export interface Plane {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  state: PlaneState;
  /** Placeholder identity colour. Polish phase replaces with a real palette (§16). */
  color: string;
}

// Placeholder sprite is drawn a little larger than the collision circle so
// the silhouette reads clearly while still giving a forgiving hitbox.
const SPRITE_SCALE = 1.5;

/**
 * Furthest extent of the placeholder sprite from the plane's centre, in
 * logical units. Used by callers to decide when to draw a wrap-ghost at the
 * opposite screen edge (§8.5).
 */
export const PLANE_SPRITE_EXTENT = HITBOX.planeRadius * SPRITE_SCALE * 1.4;

/**
 * Draw a placeholder biplane sprite: an isoceles triangle aligned to heading.
 * Replaced at the polish art pass (T11.7, §16.1).
 *
 * `xOffset` shifts the render position horizontally; use it to draw a wrap
 * ghost at (plane.x ± WORLD.width) while the sprite straddles the left/right
 * edge, so the crossing looks seamless (§8.5).
 */
export function drawPlane(
  ctx: CanvasRenderingContext2D,
  plane: Plane,
  xOffset = 0,
): void {
  const r = HITBOX.planeRadius * SPRITE_SCALE;

  ctx.save();
  ctx.translate(plane.x + xOffset, plane.y);
  ctx.rotate(plane.heading);

  // Nose points along local -y (= screen up at heading 0°).
  // Stalled planes render in a distressed red (§8.4 "look distressed");
  // polish pass will replace this with a proper wobble / smoke effect.
  ctx.fillStyle = plane.state === 'stalled' ? '#c84c4c' : plane.color;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.3);
  ctx.lineTo(-r * 0.9, r * 0.7);
  ctx.lineTo(r * 0.9, r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2a2014';
  ctx.lineWidth = STROKE.object;
  ctx.stroke();

  ctx.restore();
}
