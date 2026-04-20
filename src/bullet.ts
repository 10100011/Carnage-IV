import { BULLETS, STROKE } from './config';
import type { Plane } from './plane';

/**
 * Bullet entity (§10). Kinematic point that travels in a straight line at
 * `BULLETS.speed`. Velocity is set at spawn from the firing plane's nose
 * heading — no inheritance from the plane's own velocity, no retargeting
 * mid-flight. Edge-expiry (T4.3) and collisions (T4.4 / T4.5) layer on later
 * in Phase 4; for T4.1 bullets only self-expire via `maxLifetimeSec` so dead
 * rounds don't pile up in memory.
 */
export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * Position at the start of the current sim tick. The swept-segment
   * collision tests (§9.7, T4.4 / T4.5) run from (prevX, prevY) → (x, y) so
   * fast bullets can't tunnel through hitboxes between fixed-step updates.
   * Set equal to (x, y) at spawn so the very first tick has a valid segment.
   */
  prevX: number;
  prevY: number;
  /** Seconds since spawn. Safety cap only — real edge-expiry lands in T4.3. */
  ageSec: number;
  /**
   * Firing plane. Identity reference, so the per-plane 2-bullet cap (§10,
   * T4.2) needs no ID bookkeeping. Owner surviving or crashing doesn't
   * affect the bullet — §10 says nothing about bullets dying with their
   * shooter, and self-kill (a bullet hitting its own firer after a tight
   * turn-in) is explicitly allowed.
   */
  owner: Plane;
}

/** Bullet draw radius in logical units — §16.3 readability against both sky and ground. */
export const BULLET_RADIUS = 4;

/**
 * Spawn a round at the given nose position, aligned to `heading`. No
 * velocity inheritance from the firing plane (§10).
 */
export function spawnBullet(
  x: number,
  y: number,
  heading: number,
  owner: Plane,
): Bullet {
  return {
    x,
    y,
    vx: Math.sin(heading) * BULLETS.speed,
    vy: -Math.cos(heading) * BULLETS.speed,
    prevX: x,
    prevY: y,
    ageSec: 0,
    owner,
  };
}

/** Count live bullets owned by `owner` — used to enforce the §10 per-plane cap. */
export function countBulletsOwnedBy(bullets: readonly Bullet[], owner: Plane): number {
  let n = 0;
  for (const b of bullets) if (b.owner === owner) n++;
  return n;
}

export function drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet): void {
  ctx.fillStyle = '#ffe14a';
  ctx.strokeStyle = '#2a2014';
  ctx.lineWidth = STROKE.divider;
  ctx.beginPath();
  ctx.arc(bullet.x, bullet.y, BULLET_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
