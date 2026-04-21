import type { Bullet } from './bullet';
import { AI, BULLETS, HITBOX, PHYSICS, TOWER, WORLD, type AiDifficulty } from './config';
import type { Plane } from './plane';

const TAU = Math.PI * 2;

/** Target altitude band centre for AI. Roughly mid-playfield (§2.1 30–70%). */
const AI_COMBAT_ALTITUDE = WORLD.height * 0.4;

/**
 * Climb angle off horizontal used while altitude < AI_COMBAT_ALTITUDE.
 * §8.3's 30° is the pure speed-retention sweet-spot, but a plane lifting
 * off from its runway slot starts at altitude ~20 with the tower rising
 * to altitude ~162 directly between spawn and the map centre; 30° leaves
 * only a few tens of units of tower clearance under realistic speed
 * ramps. 40° gains altitude significantly faster and still keeps terminal
 * airspeed above `stallThreshold` (≈240 u/s terminal vs 200 u/s stall),
 * so the AI clears the tower with a comfortable margin without risking
 * a stall during the climb.
 */
const AI_CLIMB_ANGLE = 40 * (Math.PI / 180);
/** Climb headings for left-runway (nose-right) and right-runway (nose-left) spawns. */
const CLIMB_HEADING_RIGHT = Math.PI / 2 - AI_CLIMB_ANGLE;
const CLIMB_HEADING_LEFT = (3 * Math.PI) / 2 + AI_CLIMB_ANGLE;

/**
 * How close to the desired heading the AI rotates before stopping. Tight
 * (2°) because rotation wants *precise* heading control for both climb
 * angle and pursuit aim. `AI.medium.aimToleranceRad` is a separate,
 * wider (10°) cone inside which firing is good enough — a pilot that
 * stops rotating at 10° of error would climb noticeably shallower than
 * intended because the rotation stops early.
 */
const AI_ROTATION_DEADZONE = 2 * (Math.PI / 180);

/**
 * Ground-avoidance altitude floor (T6.3). Override any diving desired
 * heading below this with a climb heading. Chosen above `TOWER.topY`
 * altitude + plane radius (≈182) with healthy margin, so while active
 * it also prevents tower-body collisions — the tower-avoidance waypoint
 * below handles *pursuit around* the tower, this backstop handles
 * "target is low, I might fly into the ground chasing it".
 */
const AI_GROUND_SAFETY_ALTITUDE = 250;

/**
 * How far above `TOWER.topY` the AI aims when pursuit line-of-sight is
 * blocked by the tower (T6.3). The waypoint sits above
 * `AI_GROUND_SAFETY_ALTITUDE` so the AI can actually reach it without
 * the ground-safety override immediately overriding.
 */
const AI_TOWER_CLEARANCE = 100;

/**
 * Does segment (a → b) intersect the AABB? Liang-Barsky parameter
 * clipping — same test the bullet loop uses, inlined here so pilot.ts
 * stays self-contained until a geom module is worth extracting.
 */
function segmentCrossesAabb(
  ax: number, ay: number,
  bx: number, by: number,
  left: number, top: number,
  right: number, bottom: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, ax - left)) return false;
  if (!clip(dx, right - ax)) return false;
  if (!clip(-dy, ay - top)) return false;
  if (!clip(dy, bottom - ay)) return false;
  return true;
}

/** Signed shortest-arc difference (desired − current), wrapped into [-π, π]. */
function shortestAngularDelta(current: number, desired: number): number {
  return ((desired - current + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

/**
 * Nearest live opponent to `self`, or null if none exist. Skips crashed
 * planes (mid-respawn or permanently out) and the plane itself. Does NOT
 * account for horizontal wrap — medium AI ignores the short-arc-through-
 * the-wrap case; a future hard tier may model it.
 */
function findNearestOpponent(self: Plane, world: World): Plane | null {
  let best: Plane | null = null;
  let bestDistSq = Infinity;
  for (const p of world.planes) {
    if (p === self) continue;
    if (p.state === 'crashed') continue;
    if (p.lives <= 0) continue;
    const dx = p.x - self.x;
    const dy = p.y - self.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = p;
    }
  }
  return best;
}

/**
 * World-state snapshot passed to every pilot on each tick. Arrays are live
 * references, not copies — mutating them would break the sim, so implementations
 * treat the read-only contract seriously. Everything that doesn't change
 * during a match (tower geometry, world dimensions, physics constants) is
 * read from `config` directly instead of being plumbed through here.
 */
export interface World {
  readonly planes: readonly Plane[];
  readonly bullets: readonly Bullet[];
}

/**
 * Per-tick input a pilot produces for its plane. Mirrors the keyboard /
 * touch-button semantics the sim already knows how to apply:
 *   - `rotate` is continuous (held-style) in [-1, 1]. ±1 = full rotation
 *     rate, fractional values scale the rate (AI tiers use the factor
 *     from `config.AI[tier].rotationFactor`). Human pilots emit ±1 or 0.
 *   - `actionPress` is a one-tick rising edge (taxi commit / edge fire).
 *   - `actionHold` is continuous (held auto-fire).
 */
export interface PilotInput {
  rotate: number;
  actionPress: boolean;
  actionHold: boolean;
}

/**
 * Pilot contract — §15.1. Called once per sim tick for each piloted plane.
 * The sim applies the returned inputs via the same `applyInput` used for
 * human pilots, so AI and keyboard play go through identical state
 * transitions (taxi commit, rotation clamps, fire cap, held-auto-fire gate).
 */
export interface Pilot {
  /** Short label used in debug HUDs — keeps pilot identity visible while testing. */
  readonly label: string;
  update(plane: Plane, world: World, dt: number): PilotInput;
}

/** Shared constant idle input — avoids allocating one per tick per idle pilot. */
export const IDLE_INPUT: PilotInput = Object.freeze({
  rotate: 0,
  actionPress: false,
  actionHold: false,
}) as PilotInput;

/**
 * Placeholder AI pilot (T6.1). Produces no input, so the plane sits on its
 * runway slot until auto-start (§11) fires it — typically into the tower,
 * since it never steers. Swap for `AiPilotMedium` at T6.2 to get the
 * takeoff → climb → pursue → fire state machine (§15.1).
 */
export class AiPilotStub implements Pilot {
  readonly label = 'AI (stub)';
  update(): PilotInput {
    return IDLE_INPUT;
  }
}

/**
 * Tiered AI pilot (§15.1, §15.2). Shared state machine (takeoff → climb
 * → pursue → fire, with obstacle avoidance) parameterized by per-tier
 * constants from `config.AI[tier]`:
 *
 *   - `rotationFactor`    — scales rotate output so easy/medium AI turn
 *                           slower than full 180°/s.
 *   - `aimToleranceRad`   — firing cone width (narrow=harder, wide=easier).
 *   - `reactionDelayMs`   — input buffered by this much before applying,
 *                           simulating perceptual / decision lag.
 *   - `predictiveAim`     — hard tier leads the target by `distance /
 *                           BULLETS.speed` (first-order lead).
 *   - `panicStallChance`  — per-second probability (easy tier) of briefly
 *                           pitching straight up and stalling.
 *
 * Pre-existing behaviour (tower avoidance, ground safety floor, taxi-
 * delay randomization, climb-angle jitter, stall recovery) applies to
 * every tier unchanged — tier differentiation is purely in the tunables.
 */
export class AiPilot implements Pilot {
  readonly label: string;
  private readonly params: typeof AI[AiDifficulty];

  /** Per-spawn randomized taxi-commit delay sentinel. -1 = not initialised. */
  private taxiDelayRemaining = -1;
  /** Per-spawn randomized climb heading (base 40° plus ±~3° jitter). */
  private climbHeadingOverride: number | null = null;
  /** Pilot clock — accumulates dt so reaction buffer + panic timers are self-contained. */
  private pilotTimeSec = 0;
  /** Seconds-timestamp until which the easy-tier "panic stall" override is active. */
  private panicUntilSec = 0;
  /** Buffered past inputs for reaction-delay playback. Oldest at front. */
  private readonly inputBuffer: { t: number; input: PilotInput }[] = [];

  constructor(tier: AiDifficulty) {
    this.params = AI[tier];
    this.label = `AI ${tier}`;
  }

  update(plane: Plane, world: World, dt: number): PilotInput {
    this.pilotTimeSec += dt;
    const intended = this.computeInput(plane, world, dt);

    // Reaction delay — §15.2. Return the input this pilot "decided"
    // `reactionDelayMs` ago, not the instant one. The buffer fills up to
    // `reactionDelay / dt` entries; shift aggressively so `buffer[0]` is
    // the most-recent entry ≤ targetTime (startup returns current input
    // until the buffer spans the delay window).
    const delaySec = this.params.reactionDelayMs / 1000;
    if (delaySec <= 0) return intended;
    this.inputBuffer.push({ t: this.pilotTimeSec, input: intended });
    const targetTime = this.pilotTimeSec - delaySec;
    while (
      this.inputBuffer.length >= 2 &&
      (this.inputBuffer[1]?.t ?? Infinity) <= targetTime
    ) {
      this.inputBuffer.shift();
    }
    return this.inputBuffer[0]?.input ?? IDLE_INPUT;
  }

  /** Compute the instant, un-delayed input — the reaction delay wraps this. */
  private computeInput(plane: Plane, world: World, dt: number): PilotInput {
    if (plane.state === 'crashed' || plane.state === 'eliminated') {
      return IDLE_INPUT;
    }

    // Fresh-spawn randomization. Taxi delay spreads over 0–1.2 s, well
    // under the 5 s anti-camping auto-start (§11). Climb-angle jitter of
    // ±~3° stays within the non-stalling margin around the 40° base.
    if (
      plane.state === 'grounded' &&
      !plane.taxiCommitted &&
      this.taxiDelayRemaining < 0
    ) {
      this.taxiDelayRemaining = Math.random() * 1.2;
      const climbAngleJitter = (Math.random() - 0.5) * 0.1;
      const spawnLeft = plane.spawn.x < WORLD.width / 2;
      this.climbHeadingOverride = spawnLeft
        ? Math.PI / 2 - (AI_CLIMB_ANGLE + climbAngleJitter)
        : (3 * Math.PI) / 2 + (AI_CLIMB_ANGLE + climbAngleJitter);
      this.panicUntilSec = 0;
    }

    if (plane.state === 'grounded') {
      if (!plane.taxiCommitted) {
        this.taxiDelayRemaining -= dt;
        if (this.taxiDelayRemaining <= 0) {
          this.taxiDelayRemaining = -1;
          return { rotate: 0, actionPress: true, actionHold: false };
        }
      }
      return IDLE_INPUT;
    }

    if (plane.state === 'stalled') {
      // Stall recovery (§8.4): rotate to nose-down at the tier's rotation
      // rate. Stop once within `stallRecoveryPitchTolerance` of π so
      // gravity rebuilds airspeed; sim flips back to airborne on the
      // next tick meeting both criteria.
      const diff = shortestAngularDelta(plane.heading, Math.PI);
      const rotate =
        Math.abs(diff) < PHYSICS.stallRecoveryPitchTolerance
          ? 0
          : (diff > 0 ? 1 : -1) * this.params.rotationFactor;
      return { rotate, actionPress: false, actionHold: false };
    }

    // Panic stall (easy tier, §15.2). Per-second chance to enter a panic
    // state that forces the nose straight up until the plane stalls. The
    // existing stall-recovery branch above handles pulling out — so the
    // net effect is a lost fight and a dive.
    if (this.params.panicStallChance > 0) {
      if (
        this.pilotTimeSec >= this.panicUntilSec &&
        Math.random() < this.params.panicStallChance * dt
      ) {
        this.panicUntilSec = this.pilotTimeSec + 2.0;
        console.log(`[ai ${this.label}] panic stall triggered`);
      }
    }
    const inPanic = this.pilotTimeSec < this.panicUntilSec;

    // Airborne.
    const altitude = WORLD.groundY - plane.y;
    const target = findNearestOpponent(plane, world);
    const spawnLeft = plane.spawn.x < WORLD.width / 2;
    const climbHeading =
      this.climbHeadingOverride ??
      (spawnLeft ? CLIMB_HEADING_RIGHT : CLIMB_HEADING_LEFT);

    let desiredHeading: number;
    let pursuing = false;
    let losBlocked = false;

    if (inPanic) {
      desiredHeading = 0; // straight up — forces climb penalty to stall us
    } else if (altitude < AI_COMBAT_ALTITUDE || target === null) {
      desiredHeading = climbHeading;
    } else {
      // Pursue. Tower blocks LOS → route over the top via waypoint.
      // Otherwise aim at target position, optionally lead the target by
      // bullet travel time when the tier has predictiveAim enabled.
      const towerLeft = TOWER.centreX - TOWER.width / 2;
      const towerRight = TOWER.centreX + TOWER.width / 2;
      losBlocked = segmentCrossesAabb(
        plane.x, plane.y, target.x, target.y,
        towerLeft, TOWER.topY, towerRight, WORLD.groundY,
      );
      let aimX: number;
      let aimY: number;
      if (losBlocked) {
        aimX = TOWER.centreX;
        aimY = TOWER.topY - AI_TOWER_CLEARANCE;
      } else if (this.params.predictiveAim) {
        // First-order lead: assume target continues at its current
        // velocity for the bullet's flight time. Bullets have no
        // velocity inheritance (§10), so travel time is purely
        // distance / BULLETS.speed.
        const dx0 = target.x - plane.x;
        const dy0 = target.y - plane.y;
        const dist = Math.hypot(dx0, dy0);
        const bulletTime = dist / BULLETS.speed;
        aimX = target.x + target.vx * bulletTime;
        aimY = target.y + target.vy * bulletTime;
      } else {
        aimX = target.x;
        aimY = target.y;
      }
      const dx = aimX - plane.x;
      const dy = aimY - plane.y;
      desiredHeading = ((Math.atan2(dx, -dy) % TAU) + TAU) % TAU;
      // §10: don't fire at a runway-camped target — bullets pass through.
      const targetOnRunway = target.y + HITBOX.planeRadius >= WORLD.groundY;
      pursuing = !targetOnRunway;
    }

    // Ground-avoidance backstop (§15.1, T6.3). Only overrides when not
    // actively panicking — during panic we *want* the nose up so the
    // stall triggers.
    if (
      !inPanic &&
      altitude < AI_GROUND_SAFETY_ALTITUDE &&
      -Math.cos(desiredHeading) > 0
    ) {
      desiredHeading = climbHeading;
      pursuing = false;
    }

    const diff = shortestAngularDelta(plane.heading, desiredHeading);
    // Rotation scaled by tier's rotationFactor; firing cone uses tier's
    // aimToleranceRad. Easy is lazy on both, hard is sharp on both.
    const rotate =
      Math.abs(diff) < AI_ROTATION_DEADZONE
        ? 0
        : (diff > 0 ? 1 : -1) * this.params.rotationFactor;
    const firingAligned =
      !inPanic &&
      pursuing &&
      !losBlocked &&
      Math.abs(diff) < this.params.aimToleranceRad;

    return {
      rotate,
      actionPress: false,
      actionHold: firingAligned,
    };
  }
}

