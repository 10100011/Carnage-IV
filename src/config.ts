// Single source of truth for tunable game constants.
//
// Every value here is an INITIAL GUESS. Tune during Phase 5 / 8 / 11 feel
// checks — see PROMPT.md §2.1 tuning anchors and §19 qualitative feel check.
// §-references point back to PROMPT.md.

export const DEG = Math.PI / 180;

// Derived world geometry, computed once so downstream consts can reference it.
const WIDTH = 1920;
const HEIGHT = 1080;
const HUD_HEIGHT = HEIGHT * 0.10;
const GROUND_Y = HEIGHT - HUD_HEIGHT;
const CEILING_STALL_Y = HEIGHT * 0.05;
const TOWER_W = WIDTH * 0.08;
const TOWER_H = HEIGHT * 0.15;

/** Logical 16:9 playfield. Actual pixel size scales to the viewport. (§6, §7) */
export const WORLD = {
  width: WIDTH,
  height: HEIGHT,
  /** Bottom HUD strip height (§7 — ~10% of playfield). */
  hudHeight: HUD_HEIGHT,
  /** Ground / runway-surface y. Top of the HUD strip. A plane's hitbox touching this line while airborne = crash (§9.8). */
  groundY: GROUND_Y,
  /** Top-of-screen stall line (§2.1 ~95% height → top 5% is graze zone, §8.4). */
  ceilingStallY: CEILING_STALL_Y,
} as const;

/** Central tower — indestructible, solid to planes and bullets (§7, §9.6). */
export const TOWER = {
  width: TOWER_W,
  height: TOWER_H,
  /** Centred on the playfield horizontally (§7). */
  centreX: WIDTH / 2,
  /** Top edge y of the tower's AABB (tower sits on the runway surface). */
  topY: GROUND_Y - TOWER_H,
} as const;

/** Flight physics (§8). Units are logical-units / second. Angles in radians. */
export const PHYSICS = {
  /** Gravity (§8.3, §8.4). Applied always; dominates during stall. */
  gravity: 300,

  /** In-air thrust along the flight vector, pre-gravity coupling (§8.2, §8.3). Airborne thrust is constant; no throttle. */
  thrust: 450,

  /** Rotation rate (§8.1). 180°/sec initial guess. */
  rotationRate: 180 * DEG,

  /** Below this airspeed the plane stalls (§8.4). */
  stallThreshold: 150,

  /** Plane leaves the runway when airspeed exceeds this (§11). */
  liftOffThreshold: 200,

  /** Target level-flight terminal airspeed. Bullet speed must stay above this (§10). */
  maxAirspeed: 700,

  /** Recovery from stall requires pitch within this many radians of straight-down (180°) AND airspeed > stallThreshold (§8.4). */
  stallRecoveryPitchTolerance: 15 * DEG,

  // Pitch-vs-speed curve parameters (§8.3).
  // Rough model: along the flight vector,
  //   accel = thrust − drag·speed − climbPenaltyMultiplier·gravity·sin(pitchOffHorizontal)
  // so climbing steeper than ~30° produces net deceleration. Tune in Phase 2.
  /** Exaggerates gravity's effect on climbs / dives (§8.3). >1 = steep climbs decelerate. */
  climbPenaltyMultiplier: 1.5,
  /** Linear drag coefficient — sets level-flight terminal airspeed ≈ thrust / drag. */
  drag: 0.7,
} as const;

/** Bullets (§10). */
export const BULLETS = {
  /** Constant. Must stay strictly greater than PHYSICS.maxAirspeed (§10). */
  speed: 1000,
  /** §10: at most 2 bullets alive per plane at any time. */
  maxPerPlane: 2,
  /** Safety cap on bullet lifetime. Normally bullets expire at the screen edge (§10). */
  maxLifetimeSec: 2.5,
  /**
   * Minimum seconds between auto-fires while the action button is held. Edge
   * presses (discrete taps) bypass this and are gated only by `maxPerPlane`,
   * so skilled players can still burst-fire both rounds instantly. Not in
   * PROMPT.md §10 as of v4.3 — design tweak added after T4.2.
   */
  autoFireIntervalSec: 1.0,
} as const;

/** Collision geometry (§9.7). */
export const HITBOX = {
  /** Plane hitbox is a circle, rotation-invariant (§9.7). */
  planeRadius: 20,
} as const;

/** Match structure (§12). */
export const MATCH = {
  /** Lives per player at match start (§12). */
  startingLives: 8,
  /** Explosion / respawn delay after a crash (§12). */
  respawnDelaySec: 1.5,
  /** Anti-camping idle time before auto-start fires (§11). */
  autoStartIdleSec: 5.0,
  /** Warning-pulse timings relative to auto-start — T−2 s and T−1 s (§11). */
  autoStartWarningsSec: [2.0, 1.0] as const,
} as const;

/**
 * Player-count rules. Not individually enumerated in §18 but referenced often
 * enough (§9.1, §9.3, §13.1) that centralising them here honours the
 * single-source-of-truth discipline in §4.
 */
export const PLAYERS = {
  /** §9.1. */
  minPerMatch: 2,
  /** §9.1. */
  maxPerMatch: 8,
  /** §9.1 — keyboard shares limit us to 2 local humans. */
  maxHumansLocal: 2,
  /** Total plane count at or above this switches the match to Dogfight mode (§9.3). */
  dogfightModeMinPlanes: 5,
} as const;

/**
 * AI per-tier parameters (§15.2, §18).
 *
 * - rotationFactor     fraction of player rotation rate the AI achieves
 * - aimToleranceRad    half-angle of the firing cone; wider = sloppier
 * - reactionDelayMs    lag between stimulus and response
 * - predictiveAim      lead bullets against opponent trajectory (hard only)
 * - panicStallChance   per-second probability of a panic stall under pressure (easy only)
 */
export const AI = {
  easy: {
    rotationFactor: 0.5,
    aimToleranceRad: 25 * DEG,
    reactionDelayMs: 800,
    predictiveAim: false,
    panicStallChance: 0.02,
  },
  medium: {
    rotationFactor: 0.8,
    aimToleranceRad: 10 * DEG,
    reactionDelayMs: 300,
    predictiveAim: false,
    panicStallChance: 0,
  },
  hard: {
    rotationFactor: 1.0,
    aimToleranceRad: 4 * DEG,
    reactionDelayMs: 100,
    predictiveAim: true,
    panicStallChance: 0,
  },
} as const;

export type AiDifficulty = keyof typeof AI;

/**
 * Purely cosmetic values — changing these affects look only, not gameplay.
 * Kept here so the "single source of truth" discipline (§4) covers visuals
 * as well as physics.
 */
export const VISUAL = {
  /** Tan runway band drawn above WORLD.groundY. Gameplay ground line is WORLD.groundY regardless. */
  runwayThickness: 18,
} as const;

/**
 * Canvas stroke-width convention, in logical units. Used across all render
 * modules so line weights have consistent semantic meaning.
 */
export const STROKE = {
  /** Thin separator lines (HUD top edge, panel dividers). */
  divider: 2,
  /** Outlines around world objects (planes, tower, bullets). */
  object: 3,
  /** Emphasis borders (match-start banners, highlighted UI). */
  emphasis: 5,
} as const;

// Load-time invariants. These are cheap self-checks that catch mis-tuning
// before it becomes a runtime mystery. Add new ones alongside the constants
// whose relationships matter.
if (BULLETS.speed <= PHYSICS.maxAirspeed) {
  throw new Error(
    `config: BULLETS.speed (${BULLETS.speed}) must be strictly greater than PHYSICS.maxAirspeed (${PHYSICS.maxAirspeed}) — PROMPT.md §10.`,
  );
}
if (PHYSICS.liftOffThreshold <= PHYSICS.stallThreshold) {
  throw new Error(
    `config: PHYSICS.liftOffThreshold (${PHYSICS.liftOffThreshold}) must exceed PHYSICS.stallThreshold (${PHYSICS.stallThreshold}) — otherwise planes would stall the instant they lift off.`,
  );
}
