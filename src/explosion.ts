import { MATCH } from './config';

/**
 * Crash effect particles — spawned by `spawnExplosion` at the crash site and
 * aged by `updateExplosions` until their per-particle lifetime elapses. T11.1.
 *
 * Two visual components share the same particle type:
 *
 *   `kind: 'fleck'`  — radial debris that drifts outward and falls under
 *                      mild gravity. Tinted with the plane's signature
 *                      colour mixed with hot ember tones.
 *   `kind: 'ring'`   — single expanding shockwave drawn as a stroke ring
 *                      that fades over its lifetime. One per crash.
 *
 * Lifetimes are scoped under `MATCH.respawnDelaySec` so the entire effect
 * resolves inside the same window the crash already pauses for. We don't
 * want lingering smoke past respawn.
 */
export type ExplosionParticleKind = 'fleck' | 'ring' | 'smoke';

export interface ExplosionParticle {
  kind: ExplosionParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since spawn. */
  ageSec: number;
  /** Total seconds the particle is alive. */
  lifetimeSec: number;
  /** Fleck radius / ring start radius, in logical units. */
  radius: number;
  color: string;
}

const FLECK_COUNT = 16;
const FLECK_SPEED_MIN = 220;
const FLECK_SPEED_RANGE = 240;
const FLECK_GRAVITY = 380;
const FLECK_DRAG = 0.94;
/** Cap fleck lifetime under the respawn window so smoke doesn't outlive the wreck. */
const FLECK_LIFETIME = Math.min(0.95, MATCH.respawnDelaySec - 0.05);
const RING_LIFETIME = 0.45;
const RING_START_R = 6;
const RING_END_R = 92;

/** Hot-ember palette mixed with the plane's signature colour for variety. */
const EMBER_COLOURS = ['#fff5b0', '#ffd060', '#ff8a3c'];

/**
 * Spawn a fresh crash explosion centred at (x, y), tinted partly by `color`
 * (the crashing plane's signature) for visual identity. Mutates `into` —
 * caller owns the array (typically a single live-explosions list per match).
 */
export function spawnExplosion(
  into: ExplosionParticle[],
  x: number,
  y: number,
  color: string,
): void {
  into.push({
    kind: 'ring',
    x,
    y,
    vx: 0,
    vy: 0,
    ageSec: 0,
    lifetimeSec: RING_LIFETIME,
    radius: RING_START_R,
    color: '#fff5b0',
  });
  for (let i = 0; i < FLECK_COUNT; i++) {
    // Even angular spread + small jitter so the ring doesn't look
    // mechanical, then radial velocity from a tight band.
    const ang = (i / FLECK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const speed = FLECK_SPEED_MIN + Math.random() * FLECK_SPEED_RANGE;
    const palette =
      i % 4 === 0 ? color : EMBER_COLOURS[i % EMBER_COLOURS.length]!;
    into.push({
      kind: 'fleck',
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 60,
      ageSec: 0,
      lifetimeSec: FLECK_LIFETIME * (0.7 + Math.random() * 0.5),
      radius: 3 + Math.random() * 2,
      color: palette,
    });
  }
}

/**
 * Spawn a single grey smoke puff (T11.3) at (x, y). Rises with a touch of
 * lateral jitter, grows outward, and fades. Caller decides emission rate
 * — this just appends one particle. Lives in the same array as crash
 * flecks / rings so all transient particles share one update / draw pass.
 */
export function spawnStallPuff(
  into: ExplosionParticle[],
  x: number,
  y: number,
): void {
  into.push({
    kind: 'smoke',
    x,
    y,
    vx: (Math.random() - 0.5) * 40,
    vy: -50 - Math.random() * 40,
    ageSec: 0,
    lifetimeSec: 0.8 + Math.random() * 0.4,
    radius: 4 + Math.random() * 3,
    color: '#cfcfcf',
  });
}

/**
 * Age the particle list in place: integrate motion, apply mild gravity +
 * drag to flecks, splice any particle past its lifetime. Rings sit fixed
 * but expand visually in `drawExplosions` based on their age fraction.
 */
export function updateExplosions(
  particles: ExplosionParticle[],
  dt: number,
): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.ageSec += dt;
    if (p.ageSec >= p.lifetimeSec) {
      particles.splice(i, 1);
      continue;
    }
    if (p.kind === 'fleck') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += FLECK_GRAVITY * dt;
      // Frame-rate-independent drag: damp by FLECK_DRAG^dt rather than a
      // raw multiply so the sim's fixed dt doesn't bake into the curve.
      const damp = Math.pow(FLECK_DRAG, dt * 60);
      p.vx *= damp;
      p.vy *= damp;
    } else if (p.kind === 'smoke') {
      // Smoke drifts with weak drag, no gravity (rises naturally from
      // its initial upward vy). Plume gradually slows so puffs cluster
      // near the source rather than streaking off.
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const damp = Math.pow(0.92, dt * 60);
      p.vx *= damp;
      p.vy *= damp;
    }
  }
}

export function drawExplosions(
  ctx: CanvasRenderingContext2D,
  particles: readonly ExplosionParticle[],
): void {
  ctx.save();
  for (const p of particles) {
    const t = p.ageSec / p.lifetimeSec;
    const alpha = 1 - t;
    if (p.kind === 'fleck') {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * (1 - 0.4 * t), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'smoke') {
      // Smoke puff: starts small + opaque, grows + fades. Lower max alpha
      // so it reads as a light haze rather than a solid blob over the
      // plane sprite below it.
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * (1 + 0.8 * t), 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Shockwave: stroked ring that grows from RING_START_R → RING_END_R.
      const r = RING_START_R + (RING_END_R - RING_START_R) * t;
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
