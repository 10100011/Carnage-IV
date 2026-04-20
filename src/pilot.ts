import type { Bullet } from './bullet';
import { AI, HITBOX, PHYSICS, TOWER, WORLD } from './config';
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
 *   - `rotate` is continuous (held-style).
 *   - `actionPress` is a one-tick rising edge (taxi commit / edge fire).
 *   - `actionHold` is continuous (held auto-fire).
 * Human pilots derive these from real keystate; AI computes them.
 */
export interface PilotInput {
  rotate: -1 | 0 | 1;
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
 * Medium-tier AI pilot (§15.1, §15.2, T6.2). State machine over the plane's
 * own `state` + altitude + opponent presence:
 *
 *   grounded (!taxiCommitted) → commit taxi (emit actionPress once).
 *   grounded ( taxiCommitted) → idle; physics is taxiing us.
 *   stalled                   → rotate to nose-down (§8.4 recovery); no fire.
 *   airborne & low altitude   → climb at the §8.3 sweet spot (30° off
 *                               horizontal) on the plane's spawn side.
 *   airborne & in band, with  → rotate to aim at target's current position
 *     a living opponent         (no lead — medium has predictiveAim:false)
 *                               and hold fire while aligned within
 *                               `AI.medium.aimToleranceRad`.
 *
 * Held auto-fire gives the 1/s cadence from T4.2's tweak automatically, so
 * the AI doesn't need its own fire cooldown. Tower / ground obstacle
 * avoidance is T6.3 — today the AI may still fly into the tower mid-
 * pursue.
 */
export class AiPilotMedium implements Pilot {
  readonly label = 'AI med';

  /**
   * Per-spawn randomized state. Two concurrently spawned AI planes would
   * otherwise commit taxi on the same tick, lift off at the same time,
   * climb at the same angle, and converge at the same point above the
   * tower — a reliable head-on kill every match. Randomizing the taxi
   * delay desyncs lift-off times; jittering the climb angle keeps their
   * ascent trajectories from being parallel even if the delay happens to
   * land near zero.
   *
   * `-1` sentinel on `taxiDelayRemaining` means "not yet initialised for
   * this spawn". The init block below sets both fields the first tick the
   * plane is grounded + uncommitted; on taxi commit we reset the delay
   * sentinel to -1 so the next respawn re-randomizes.
   */
  private taxiDelayRemaining = -1;
  private climbHeadingOverride: number | null = null;

  update(plane: Plane, world: World, dt: number): PilotInput {
    if (plane.state === 'crashed') return IDLE_INPUT;

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
    }

    if (plane.state === 'grounded') {
      if (!plane.taxiCommitted) {
        this.taxiDelayRemaining -= dt;
        if (this.taxiDelayRemaining <= 0) {
          // Consume + reset so the next respawn re-randomizes.
          this.taxiDelayRemaining = -1;
          return { rotate: 0, actionPress: true, actionHold: false };
        }
      }
      return IDLE_INPUT;
    }

    if (plane.state === 'stalled') {
      // Stall recovery (§8.4): rotate to nose-down. Stop once within
      // `stallRecoveryPitchTolerance` of π so gravity rebuilds airspeed;
      // the sim flips state back to airborne on the next tick that meets
      // both pitch and speed criteria.
      const diff = shortestAngularDelta(plane.heading, Math.PI);
      const rotate: -1 | 0 | 1 =
        Math.abs(diff) < PHYSICS.stallRecoveryPitchTolerance ? 0 : diff > 0 ? 1 : -1;
      return { rotate, actionPress: false, actionHold: false };
    }

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
    if (altitude < AI_COMBAT_ALTITUDE || target === null) {
      // Climb or idle-hold-altitude. Spawn side picks which angle — keeps
      // the plane heading inward toward the contested airspace rather than
      // wrapping out the far edge.
      desiredHeading = climbHeading;
    } else {
      // Pursue: aim at target's current position — unless the tower blocks
      // LOS, in which case route over the top. Heading convention (§8.1):
      // nose direction (sin h, -cos h) = (dx, dy) / |d| ⇒ h = atan2(dx, -dy).
      const towerLeft = TOWER.centreX - TOWER.width / 2;
      const towerRight = TOWER.centreX + TOWER.width / 2;
      losBlocked = segmentCrossesAabb(
        plane.x, plane.y, target.x, target.y,
        towerLeft, TOWER.topY, towerRight, WORLD.groundY,
      );
      const aimX = losBlocked ? TOWER.centreX : target.x;
      const aimY = losBlocked ? TOWER.topY - AI_TOWER_CLEARANCE : target.y;
      const dx = aimX - plane.x;
      const dy = aimY - plane.y;
      desiredHeading = ((Math.atan2(dx, -dy) % TAU) + TAU) % TAU;
      // Rotate toward the target regardless, but don't fire while the
      // target's hitbox still touches the runway — §10 grounded immunity
      // means the round would just pass through. Keeps tracking live so
      // the trigger resumes the instant the target lifts off.
      const targetOnRunway =
        target.y + HITBOX.planeRadius >= WORLD.groundY;
      pursuing = !targetOnRunway;
    }

    // Ground-avoidance backstop (§15.1, T6.3). If we're below the safety
    // floor AND the desired heading dives, pitch up to the climb heading
    // instead. Suppresses firing because the override isn't aimed at
    // anything we'd want to shoot. With the floor set above tower-top
    // altitude, this also makes accidental tower-body crashes impossible
    // during pursuit — a second line of defence behind the tower routing.
    if (altitude < AI_GROUND_SAFETY_ALTITUDE && -Math.cos(desiredHeading) > 0) {
      desiredHeading = climbHeading;
      pursuing = false;
    }

    const diff = shortestAngularDelta(plane.heading, desiredHeading);
    // Rotation uses the tight deadzone so climb / aim headings are held
    // precisely; firing uses the wider `aimToleranceRad` cone so medium
    // AI doesn't have to pin the opponent in a 2° window before pulling
    // the trigger. LOS-blocked pursuit still rotates toward the waypoint
    // but can't fire — the "aligned" heading would put the round into the
    // tower, not the target.
    const rotate: -1 | 0 | 1 =
      Math.abs(diff) < AI_ROTATION_DEADZONE ? 0 : diff > 0 ? 1 : -1;
    const firingAligned =
      pursuing && !losBlocked && Math.abs(diff) < AI.medium.aimToleranceRad;

    return {
      rotate,
      actionPress: false,
      // Held action while aligned on a live target: 2-bullet cap + 1/s
      // held-auto-fire interval naturally pace the shots.
      actionHold: firingAligned,
    };
  }
}
