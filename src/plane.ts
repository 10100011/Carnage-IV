import { HITBOX, STROKE } from './config';

/**
 * Plane life-cycle states. §8.2 / §8.4 / §11 / §12.
 *   grounded   — sitting on runway, pre-taxi-commit or taxiing.
 *   airborne   — free flight, under pitch-coupling physics.
 *   stalled    — airspeed/ceiling stall, gravity dominates.
 *   crashed    — post-impact wreck, respawn timer ticking (may respawn or
 *                transition to `eliminated` on timeout when lives are 0).
 *   eliminated — permanently out of the match. Not rendered, not collided.
 */
export type PlaneState =
  | 'grounded'
  | 'airborne'
  | 'stalled'
  | 'crashed'
  | 'eliminated';

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
  /**
   * Set by the first action-button press while grounded — the commit-to-taxi
   * signal from §8.2.1 / §11. The state stays `grounded` while the plane
   * accelerates along the runway (T3.3); liftoff flips it to `airborne` and
   * resets this flag. Respawn (T3.5) also resets it.
   */
  taxiCommitted: boolean;
  /**
   * Seconds remaining until respawn when `state === 'crashed'` (§12,
   * `MATCH.respawnDelaySec`). Counted down by the sim; on reaching 0 the
   * plane respawns in its runway slot. Unused (kept at 0) in other states.
   * Polish-phase T11.1 will drive the explosion animation off this same
   * clock.
   */
  respawnTimerSec: number;
  /**
   * Seconds remaining on the anti-camping auto-start countdown (§11, T3.6).
   * Counts down only while `state === 'grounded' && !taxiCommitted`. Reset
   * to `MATCH.autoStartIdleSec` on spawn and on every respawn. At ≤ 0 the
   * sim flips `taxiCommitted` itself — per §11, the timer's reset semantics
   * are trivial: it runs from spawn until the player commits or auto-start
   * fires, with no intermediate "taxi-stopped" state to reset from.
   */
  autoStartTimerSec: number;
  /**
   * Sim-time (seconds) of this plane's last bullet fire. Drives the held-
   * auto-fire rate limiter (`BULLETS.autoFireIntervalSec`). Initialised to
   * `Number.NEGATIVE_INFINITY` on spawn and reset the same on respawn so the
   * first press is never rate-gated.
   */
  lastFireAtSec: number;
  /**
   * Remaining lives (§12). Starts at `MATCH.startingLives` (8). Decrements
   * on every crash — the `crashPlane` helper's idempotency guard keeps
   * multi-source same-tick crashes to a single decrement. At 0 the plane
   * is permanently out: `handleRespawn` skips the reset, so the wreck
   * stays where it fell until match end.
   */
  lives: number;
  /** Placeholder identity colour. Polish phase replaces with a real palette (§16). */
  color: string;
  /**
   * Per-plane spawn pose (runway slot + facing) per §9.2. Held on the plane
   * instance so the respawn path (T3.5 / §12) can look it up directly
   * without a parallel lookup table. Treat as readonly after construction.
   */
  spawn: { readonly x: number; readonly y: number; readonly heading: number };
  /**
   * Render the sprite horizontally flipped before heading rotation (§9.2).
   * True for right-runway planes so an asymmetric sprite (T11.7) reads with
   * its correct side-up regardless of facing. Invisible on the current
   * symmetric placeholder triangle; wired now so T11.7 is drop-in.
   */
  mirror: boolean;
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
 * Distance from the plane's centre to the tip of the placeholder sprite's
 * nose, in logical units. Used by bullet spawn so rounds emerge from the
 * visible nose rather than the circle centre (§10).
 */
export const PLANE_NOSE_OFFSET = HITBOX.planeRadius * SPRITE_SCALE * 1.3;

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
  // Stall wobble (T11.3) — small heading-jitter applied *only* to the
  // sprite, not the underlying physics heading. Combined with the smoke
  // trail spawned in the update loop and the red distress fill below,
  // the stall state is unmistakable per §16.3.
  if (plane.state === 'stalled') {
    const wobble = Math.sin(performance.now() * 0.025) * 0.18;
    ctx.rotate(wobble);
  }
  // Mirror is applied *after* rotate so it flips the sprite in its local
  // (post-rotation) frame — equivalent to negating local x before drawing.
  // That keeps wheels-down / canopy-up on the asymmetric T11.7 sprite
  // regardless of whether the plane faces left or right.
  if (plane.mirror) ctx.scale(-1, 1);

  // Nose points along local -y (= screen up at heading 0°). Fill keeps the
  // per-player signature colour even while stalled (T11.5, §16.3) — stall
  // is signalled by wobble + smoke trail + the red distress stroke below,
  // so identity stays readable. Crashed wrecks fall back to grey for a
  // beat before respawn so the kill reads at a glance.
  ctx.fillStyle = plane.state === 'crashed' ? '#555' : plane.color;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.3);
  ctx.lineTo(-r * 0.9, r * 0.7);
  ctx.lineTo(r * 0.9, r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = plane.state === 'stalled' ? '#c84c4c' : '#2a2014';
  ctx.lineWidth =
    plane.state === 'stalled' ? STROKE.emphasis : STROKE.object;
  ctx.stroke();

  ctx.restore();
}
