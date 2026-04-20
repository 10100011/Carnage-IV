import { drawArena } from './arena';
import {
  countBulletsOwnedBy,
  drawBullet,
  spawnBullet,
  type Bullet,
} from './bullet';
import { BULLETS, HITBOX, MATCH, PHYSICS, STROKE, TOWER, WORLD } from './config';
import { startLoop } from './loop';
import {
  drawPlane,
  PLANE_NOSE_OFFSET,
  PLANE_SPRITE_EXTENT,
  type Plane,
} from './plane';

const TAU = Math.PI * 2;

/**
 * Parameter `t ∈ [0, 1]` at which segment (a → b) first enters the open disk
 * of radius `radius` centred at (cx, cy), or `Infinity` if the segment
 * misses or merely grazes (tangent). A segment that starts inside the disk
 * returns 0 — it's already hitting at step start.
 *
 * Strict `<` convention (tangent = miss) matches the crash tests elsewhere.
 * Returning a t-param instead of a boolean lets the bullet loop resolve
 * same-step hits against multiple targets by picking the nearest (§9.6 +
 * §9.7): a plane in front of the tower must die before the tower blocks.
 */
function segmentCircleEntryT(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  radius: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - radius * radius;
  if (a === 0) {
    // Degenerate segment = point. Strictly inside the disk ⇒ hit at t=0.
    return c < 0 ? 0 : Infinity;
  }
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return Infinity;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2 * a);
  const t1 = (-b + sq) / (2 * a);
  if (t0 >= 0 && t0 <= 1) return t0;
  if (t0 < 0 && t1 > 0) return 0; // segment starts inside the disk
  return Infinity;
}

/**
 * Parameter `t ∈ [0, 1]` at which segment (a → b) first enters the AABB, or
 * `Infinity` if it misses. Liang-Barsky parameter clipping: tests all four
 * slabs, narrows [t0, t1] to the portion inside the rectangle, returns t0
 * on success (the entry point). A segment starting inside the rectangle
 * returns 0.
 *
 * Boundary contact counts as a hit (grazing round still blocked) — tower is
 * a solid block in §9.6, unlike the strict-< plane-circle convention.
 */
function segmentAabbEntryT(
  ax: number, ay: number,
  bx: number, by: number,
  left: number, top: number,
  right: number, bottom: number,
): number {
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
  if (!clip(-dx, ax - left)) return Infinity;
  if (!clip(dx, right - ax)) return Infinity;
  if (!clip(-dy, ay - top)) return Infinity;
  if (!clip(dy, bottom - ay)) return Infinity;
  return t0;
}

interface Viewport {
  /** Logical-units → backing-store-pixels scale factor. */
  scale: number;
  /** Backing-store pixel offset of the playfield's top-left corner. */
  offsetX: number;
  offsetY: number;
}

function init(): void {
  const canvasEl = document.getElementById('game');
  if (!(canvasEl instanceof HTMLCanvasElement)) {
    throw new Error('#game canvas element missing from index.html');
  }
  const context = canvasEl.getContext('2d');
  if (!context) {
    throw new Error('2D canvas context unavailable in this browser');
  }
  const canvas: HTMLCanvasElement = canvasEl;
  const ctx: CanvasRenderingContext2D = context;

  let viewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 };

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);

    const targetAspect = WORLD.width / WORLD.height;
    const canvasAspect = canvas.width / canvas.height;
    if (canvasAspect > targetAspect) {
      const scale = canvas.height / WORLD.height;
      viewport = {
        scale,
        offsetX: (canvas.width - WORLD.width * scale) / 2,
        offsetY: 0,
      };
    } else {
      const scale = canvas.width / WORLD.width;
      viewport = {
        scale,
        offsetX: 0,
        offsetY: (canvas.height - WORLD.height * scale) / 2,
      };
    }
  }
  resize();
  window.addEventListener('resize', resize);

  // Spawn slot math per §9.2: each runway side's usable length runs from the
  // tower's inner edge out to the playfield edge, and plane i of n on that
  // side sits at i/(n+1) of that length measured from the tower (plane 1 is
  // innermost). With two planes total (one per side), each is the midpoint
  // of its half. y places the hitbox bottom exactly on the runway surface.
  // N-plane generalization is T8.1's job; today we hand-roll n=1 per side.
  const leftInnerEdge = TOWER.centreX - TOWER.width / 2;
  const rightInnerEdge = TOWER.centreX + TOWER.width / 2;
  const groundedY = WORLD.groundY - HITBOX.planeRadius;

  function makeGroundedPlane(opts: {
    x: number;
    heading: number;
    color: string;
    mirror: boolean;
  }): Plane {
    return {
      x: opts.x,
      y: groundedY,
      vx: 0,
      vy: 0,
      heading: opts.heading,
      state: 'grounded',
      taxiCommitted: false,
      respawnTimerSec: 0,
      autoStartTimerSec: MATCH.autoStartIdleSec,
      lastFireAtSec: Number.NEGATIVE_INFINITY,
      lives: MATCH.startingLives,
      color: opts.color,
      spawn: { x: opts.x, y: groundedY, heading: opts.heading },
      mirror: opts.mirror,
    };
  }

  // P1 on the left runway, facing the tower (heading π/2).
  const plane1 = makeGroundedPlane({
    x: leftInnerEdge * 0.5,
    heading: Math.PI / 2,
    color: '#ffd27a',
    mirror: false,
  });
  // P2 on the right runway, facing the tower (heading 3π/2), sprite mirrored
  // per §9.2. T5.2 wires its input; until then it sits idle.
  const plane2 = makeGroundedPlane({
    x: (rightInnerEdge + WORLD.width) * 0.5,
    heading: 3 * Math.PI / 2,
    color: '#7ac6ff',
    mirror: true,
  });
  const planes: Plane[] = [plane1, plane2];

  // Per-plane human control bindings, index-aligned with `planes` (§14.1).
  // `null` entries mean "no human" — T6 fills those with AI pilots, and
  // stepPhysics still runs for the plane either way.
  interface Controls {
    ccw: string;
    action: string;
    cw: string;
  }
  const controls: Array<Controls | null> = [
    { ccw: 'a', action: 's', cw: 'd' },
    { ccw: 'j', action: 'k', cw: 'l' },
  ];

  // All live bullets fired by any plane. Per-plane cap (§10, T4.2) and
  // edge-expiry (T4.3) layer in next; for T4.1 the pool grows on fire and
  // shrinks only via the safety-lifetime sweep below.
  const bullets: Bullet[] = [];

  // Held-key map for input. Extracted to src/input.ts later (T5.2 P1/P2 mapping).
  // Both the held-key map and the press-edge set store lowercased key names,
  // so downstream lookups (`keys['s']`, `pressedKeys.has('s')`) work whether
  // or not caps lock is on. Non-letter keys like `[` / `]` are unaffected by
  // the lowercase pass.
  const keys: Record<string, boolean> = {};
  // One-shot press edges collected between updates. Consumed (and cleared) by
  // update() so each physical press fires exactly one action, regardless of
  // OS auto-repeat or how many sim ticks run this frame.
  const pressedKeys = new Set<string>();
  window.addEventListener('keydown', (ev) => {
    const k = ev.key.toLowerCase();
    // Result screen shortcut: Enter / Space restarts (§12 play-again). Keys
    // are not routed into the sim while frozen — matchOver already early-
    // returns in update() but blocking the press here stops stale keystate
    // from bleeding into the next match.
    if (matchOver && (k === 'enter' || k === ' ')) {
      ev.preventDefault();
      resetMatch();
      return;
    }
    if (!ev.repeat) pressedKeys.add(k);
    keys[k] = true;
  });
  window.addEventListener('keyup', (ev) => {
    keys[ev.key.toLowerCase()] = false;
  });
  // Click anywhere on the canvas while the result screen is up restarts —
  // the Play Again button is the visual affordance, but a click anywhere
  // counts (forgiving for touch / mobile when those land at T10).
  canvas.addEventListener('click', () => {
    if (matchOver) resetMatch();
  });

  let frameCount = 0;
  let simSteps = 0;
  let simTimeSec = 0;

  // Match lifecycle — §12. `matchOver` freezes the sim and shows the result
  // screen; `matchOutcome` records who won (or draw for simultaneous last-
  // life eliminations). Cleared by `resetMatch` when the player hits Play
  // Again.
  let matchOver = false;
  let matchOutcome: 'P1' | 'P2' | 'draw' | null = null;

  /**
   * Reset every plane to its spawn pose with full lives, clear all bullets
   * and per-plane timers, and flip `matchOver` off. Called when the player
   * clicks Play Again or hits Enter / Space on the result screen.
   */
  function resetMatch(): void {
    for (const p of planes) {
      p.x = p.spawn.x;
      p.y = p.spawn.y;
      p.vx = 0;
      p.vy = 0;
      p.heading = p.spawn.heading;
      p.state = 'grounded';
      p.taxiCommitted = false;
      p.respawnTimerSec = 0;
      p.autoStartTimerSec = MATCH.autoStartIdleSec;
      p.lastFireAtSec = Number.NEGATIVE_INFINITY;
      p.lives = MATCH.startingLives;
    }
    bullets.length = 0;
    // Flush any input collected while the result screen was up so it can't
    // bleed into the first tick of the new match (held rotation keys, a
    // stray taxi-commit press during result-screen fiddling, etc.).
    pressedKeys.clear();
    for (const k of Object.keys(keys)) delete keys[k];
    matchOver = false;
    matchOutcome = null;
    console.log('[match] reset — new match');
  }

  /**
   * Apply the standard crash transition to a plane and arm the explosion /
   * respawn clock (§12). Idempotent via the `crashed` guard, so if multiple
   * crash sources trigger the same tick (tower + ground in the same step,
   * bullet + tower, etc.) only the first actually fires. `reason` shows up
   * in the debug log and is useful while tuning collision ordering.
   *
   * Site-specific position fix-ups (e.g. the ground-crash y-pin) stay inline
   * at the caller; this helper owns only the state-machine transition.
   */
  function crashPlane(plane: Plane, reason: string): void {
    if (plane.state === 'crashed') return;
    plane.state = 'crashed';
    plane.vx = 0;
    plane.vy = 0;
    plane.taxiCommitted = false;
    plane.respawnTimerSec = MATCH.respawnDelaySec;
    plane.lives -= 1;
    console.log(
      `[crash] ${reason} at x=${plane.x.toFixed(0)}, y=${plane.y.toFixed(0)}, lives=${plane.lives}, simTime=${simTimeSec.toFixed(2)}s`,
    );
  }

  /**
   * Respawn handler — §12, T3.5. Crashed planes sit motionless through the
   * 1.5 s explosion delay (T11.1 will hook its animation off this same
   * clock) and then reset to their runway slot, grounded, facing the
   * original direction. `taxiCommitted` is cleared so the next press must
   * re-commit, matching the §8.2.1 respawn-resets-the-state-machine rule.
   */
  function handleRespawn(p: Plane, dt: number): void {
    if (p.state !== 'crashed') return;
    p.respawnTimerSec -= dt;
    if (p.respawnTimerSec > 0) return;
    if (p.lives <= 0) {
      // Permanently out (§12). Clamp the timer so it doesn't drift negative
      // and stays read-correct in the debug HUD; wreck stays where it fell.
      // Match-end / result-screen logic is T5.5.
      p.respawnTimerSec = 0;
      return;
    }
    p.x = p.spawn.x;
    p.y = p.spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.heading = p.spawn.heading;
    p.state = 'grounded';
    p.taxiCommitted = false;
    p.respawnTimerSec = 0;
    p.autoStartTimerSec = MATCH.autoStartIdleSec;
    p.lastFireAtSec = Number.NEGATIVE_INFINITY;
    console.log(`[respawn] simTime=${simTimeSec.toFixed(2)}s`);
  }

  /**
   * Anti-camping auto-start — §11, T3.6. While the plane sits idle on the
   * runway with no taxi committed, count down from `autoStartIdleSec`. At
   * zero the sim commits the taxi itself; because the plane faces the tower
   * that commit typically ends in a crash. T−2 s / T−1 s warning pulses
   * are visual polish (T11.2) and deliberately absent here.
   */
  function handleAutoStart(p: Plane, dt: number): void {
    if (p.state !== 'grounded' || p.taxiCommitted) return;
    p.autoStartTimerSec -= dt;
    if (p.autoStartTimerSec <= 0) {
      p.taxiCommitted = true;
      p.autoStartTimerSec = 0;
      console.log(`[auto-start] simTime=${simTimeSec.toFixed(2)}s`);
    }
  }

  /**
   * Bullet spawn from the plane's nose, gated by the 2-bullet count cap
   * (§10, T4.2). Bullet velocity = heading unit × BULLETS.speed with no
   * inheritance from the plane's own velocity (§10). Updates the plane's
   * `lastFireAtSec` so the held-auto-fire loop paces itself.
   */
  function attemptFire(p: Plane): boolean {
    if (countBulletsOwnedBy(bullets, p) >= BULLETS.maxPerPlane) return false;
    const noseX = p.x + PLANE_NOSE_OFFSET * Math.sin(p.heading);
    const noseY = p.y - PLANE_NOSE_OFFSET * Math.cos(p.heading);
    bullets.push(spawnBullet(noseX, noseY, p.heading, p));
    p.lastFireAtSec = simTimeSec;
    return true;
  }

  /**
   * Rotation input — §8.1, §14.1. Active in airborne / stalled states.
   * Grounded planes ignore rotation (§11 — they face the tower until the
   * action button commits the taxi). While the hitbox is still tangent to
   * the runway (airborne but not yet climbed), rotation is clamped to the
   * upper semicircle so the pilot can't pitch the nose into the runway
   * during takeoff — a quality-of-life guard, not a prompt-mandated rule.
   */
  function applyRotationInput(p: Plane, ctrl: Controls, dt: number): void {
    if (p.state !== 'airborne' && p.state !== 'stalled') return;
    let rot = 0;
    if (keys[ctrl.ccw]) rot -= 1;
    if (keys[ctrl.cw]) rot += 1;
    if (rot === 0) return;
    const newHeading =
      ((p.heading + rot * PHYSICS.rotationRate * dt) % TAU + TAU) % TAU;
    const onRunway = p.y + HITBOX.planeRadius >= WORLD.groundY;
    if (onRunway && Math.cos(newHeading) < 0) {
      // Snap to the nearer horizontal. Invariant: prevHeading is already in
      // the upper semicircle, so < π → clamp right (π/2), else left (3π/2).
      p.heading = p.heading < Math.PI ? Math.PI / 2 : 3 * Math.PI / 2;
    } else {
      p.heading = newHeading;
    }
  }

  /**
   * Action button — one input, two meanings (§8.2.1).
   *   grounded + !taxiCommitted → commit taxi (stepPhysics applies thrust).
   *   grounded +  taxiCommitted → ignored; a committed taxi cannot be aborted.
   *   airborne / stalled        → edge press fires; hold auto-fires every
   *                               BULLETS.autoFireIntervalSec.
   *   crashed                   → ignored.
   *
   * Stalled planes can still fire — §2 calls out the stall-to-fire-rearward
   * trick as a legitimate advanced tool. Edge presses bypass the interval
   * gate so rapid tapping can drain both rounds instantly; `attemptFire`
   * updates `lastFireAtSec` so the held check here won't double-fire.
   */
  function applyActionButton(p: Plane, ctrl: Controls): void {
    const firing = p.state === 'airborne' || p.state === 'stalled';
    if (pressedKeys.has(ctrl.action)) {
      if (p.state === 'grounded') {
        if (!p.taxiCommitted) {
          p.taxiCommitted = true;
          console.log(`[action] taxi committed at simTime=${simTimeSec.toFixed(2)}s`);
        }
      } else if (firing) {
        attemptFire(p);
      }
    }
    if (
      firing &&
      keys[ctrl.action] &&
      simTimeSec - p.lastFireAtSec >= BULLETS.autoFireIntervalSec
    ) {
      attemptFire(p);
    }
  }

  /**
   * Per-plane physics + environment collisions — taxi / airborne / stall
   * branches, position integration, horizontal wrap (§8.5), top-of-screen
   * clamp, tower collision (§9.6), ground crash (§9.8). Bullet collisions
   * live in the shared bullet loop below since they affect other planes.
   */
  function stepPhysics(p: Plane, dt: number): void {
    if (p.state === 'grounded' && p.taxiCommitted) {
      // Runway taxi — §8.2, §11. Full-power accel along heading; no gravity
      // on the surface, so drag is the only resistance. Lift-off at
      // newSpeed > liftOffThreshold flips state → airborne; §10 grounded-
      // immunity drops automatically once the plane climbs off the surface.
      const speed = Math.hypot(p.vx, p.vy);
      const accel = PHYSICS.thrust - PHYSICS.drag * speed;
      let newSpeed = speed + accel * dt;
      if (newSpeed < 0) newSpeed = 0;
      const dirX = Math.sin(p.heading);
      const dirY = -Math.cos(p.heading);
      p.vx = newSpeed * dirX;
      p.vy = newSpeed * dirY;
      if (newSpeed > PHYSICS.liftOffThreshold) {
        p.state = 'airborne';
        p.taxiCommitted = false;
      }
    } else if (p.state === 'airborne') {
      // Airborne physics — §8.2, §8.3. Velocity stays aligned with heading;
      // pitch coupling handles gravity's effect:
      //   accel = thrust − drag·speed − climbPenalty·g·cos(heading)
      const speed = Math.hypot(p.vx, p.vy);
      const accel =
        PHYSICS.thrust -
        PHYSICS.drag * speed -
        PHYSICS.climbPenaltyMultiplier * PHYSICS.gravity * Math.cos(p.heading);
      let newSpeed = speed + accel * dt;
      if (newSpeed < 0) newSpeed = 0;
      if (newSpeed > PHYSICS.maxAirspeed) newSpeed = PHYSICS.maxAirspeed;
      const dirX = Math.sin(p.heading);
      const dirY = -Math.cos(p.heading);
      p.vx = newSpeed * dirX;
      p.vy = newSpeed * dirY;
      // Stall triggers — §8.4. (a) airspeed < stallThreshold, or (b) plane
      // enters the top-of-screen zone (§2.1 top ~5%).
      if (newSpeed < PHYSICS.stallThreshold || p.y < WORLD.ceilingStallY) {
        p.state = 'stalled';
      }
    } else if (p.state === 'stalled') {
      // Stalled — thrust off, gravity acts, drag continues. Rotation still
      // responds (handled by applyRotationInput above).
      const ax = -PHYSICS.drag * p.vx;
      const ay = -PHYSICS.drag * p.vy + PHYSICS.gravity;
      p.vx += ax * dt;
      p.vy += ay * dt;
      // Recovery — §8.4. Nose within tolerance of straight-down AND airspeed
      // above stallThreshold. Next airborne tick realigns velocity to heading.
      const pitchFromDown = Math.abs(p.heading - Math.PI);
      const speedAfter = Math.hypot(p.vx, p.vy);
      if (
        pitchFromDown <= PHYSICS.stallRecoveryPitchTolerance &&
        speedAfter > PHYSICS.stallThreshold
      ) {
        p.state = 'airborne';
      }
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Horizontal wrap — §8.5. Centre-based; altitude / velocity / heading
    // preserved. PHYSICS.maxAirspeed * dt ≈ 11.7 u per step ≪ WORLD.width.
    if (p.x < 0) p.x += WORLD.width;
    else if (p.x >= WORLD.width) p.x -= WORLD.width;

    // Top-of-screen hard clamp (non-fatal): ceiling stall already triggered,
    // but upward momentum can still carry a stalled plane past y=0. Clamp
    // centre at 0 and zero any upward vy so gravity takes over immediately.
    if (p.y < 0) {
      p.y = 0;
      if (p.vy < 0) p.vy = 0;
    }

    // Tower collision — §9.6, §9.7. Plane circle vs tower AABB. Fires in
    // any non-crashed state. Closest-point-on-AABB squared-distance test.
    // Strict `<` so tangent contact isn't a crash — same convention as the
    // ground check below.
    if (p.state !== 'crashed') {
      const towerLeft = TOWER.centreX - TOWER.width / 2;
      const towerRight = TOWER.centreX + TOWER.width / 2;
      const cx = Math.max(towerLeft, Math.min(p.x, towerRight));
      const cy = Math.max(TOWER.topY, Math.min(p.y, WORLD.groundY));
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (dx * dx + dy * dy < HITBOX.planeRadius * HITBOX.planeRadius) {
        crashPlane(p, 'tower contact');
      }
    }

    // Ground crash — §9.8. Strict-`>` so a just-lifted plane with hitbox
    // tangent to the runway doesn't insta-crash. Pin wreck on the surface
    // before flipping state — ground is the one crash site that needs a
    // position fix-up.
    if (
      (p.state === 'airborne' || p.state === 'stalled') &&
      p.y + HITBOX.planeRadius > WORLD.groundY
    ) {
      p.y = WORLD.groundY - HITBOX.planeRadius;
      crashPlane(p, 'ground contact');
    }
  }

  function update(dt: number): void {
    // While a match is over the sim freezes — the result screen renders on
    // top of the last frame and the only live input is "play again" (§12).
    if (matchOver) return;
    simSteps++;
    simTimeSec += dt;

    // Time-based triggers (both planes) before inputs fire, so a respawning
    // plane's state is already 'grounded' by the time input runs this tick.
    for (const p of planes) {
      handleRespawn(p, dt);
      handleAutoStart(p, dt);
    }

    // Human input, one plane per binding. Both planes read `pressedKeys`
    // before it's cleared below, so same-tick presses by both players each
    // get their edge seen exactly once.
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i]!;
      const ctrl = controls[i];
      if (!ctrl) continue; // AI pilots land in T6.
      applyRotationInput(p, ctrl, dt);
      applyActionButton(p, ctrl);
    }
    pressedKeys.clear();

    // Per-plane physics + environment collisions.
    for (const p of planes) stepPhysics(p, dt);

    // Plane-plane mid-air collision — §9.3 Close Quarters, §9.5 ground
    // exemption. With 2 planes we're in Close Quarters: any pair whose
    // hitboxes overlap *in the air* crashes both. §9.5: planes on the
    // runway (hitbox in contact with surface) don't collide — taxi stacking
    // is allowed. The moment either plane lifts off, air rules apply.
    //
    // At max airspeed (700 u/s) the per-tick relative motion between a pair
    // is ≤ 2·(700·dt) ≈ 23 u, well under 2·planeRadius = 40 u, so a static
    // end-of-tick circle-circle test catches every overlap without a swept
    // capsule. Dogfight-mode pass-through (≥ 5 planes, §9.3 / §9.4) wires
    // in at T8.3, with the ghost-through visual telegraph at T8.5.
    const minRamDistSq = (2 * HITBOX.planeRadius) * (2 * HITBOX.planeRadius);
    for (let i = 0; i < planes.length; i++) {
      const a = planes[i]!;
      if (a.state === 'crashed') continue;
      if (a.y + HITBOX.planeRadius >= WORLD.groundY) continue;
      for (let j = i + 1; j < planes.length; j++) {
        const b = planes[j]!;
        if (b.state === 'crashed') continue;
        if (b.y + HITBOX.planeRadius >= WORLD.groundY) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy < minRamDistSq) {
          crashPlane(a, `ram vs P${j + 1}`);
          crashPlane(b, `ram vs P${i + 1}`);
        }
      }
    }

    // Bullet motion + swept-segment plane collision — §9.7, §10, T4.4.
    // Iterate backwards so in-place splice doesn't skip the next element.
    // Each tick:
    //   1. Snapshot (prevX, prevY) for the swept segment.
    //   2. Integrate straight-line motion at constant speed.
    //   3. Test the (prev → curr) segment against every non-crashed plane's
    //      hitbox circle. At BULLETS.speed * dt ≈ 16.7 u per step and a
    //      40 u plane diameter, the segment can't skip a plane between
    //      ticks, so no capsule-vs-capsule needed.
    //   4. Self-kill allowed (§10) — owner is not excluded from the test.
    //   5. On hit: crash the plane (one-shot), consume the bullet.
    //   6. Safety lifetime reap until T4.3 lands the real edge-expiry rule.
    const planesForCollision: Plane[] = planes;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]!;
      b.prevX = b.x;
      b.prevY = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.ageSec += dt;

      let consumed = false;

      // Resolve tower + plane hits by nearest-along-segment (t-param). The
      // §9.6 tower-blocks-bullets rule and §2's "tower as cover" semantics
      // only work if the nearer hit wins: a plane in front of the tower
      // must die before the tower blocks, and vice versa. On an exact tie
      // (zero-probability in float) the tower wins — cover-biased.
      const towerT = segmentAabbEntryT(
        b.prevX, b.prevY,
        b.x, b.y,
        TOWER.centreX - TOWER.width / 2,
        TOWER.topY,
        TOWER.centreX + TOWER.width / 2,
        WORLD.groundY,
      );

      let planeT = Infinity;
      let hitTarget: Plane | undefined;
      for (const target of planesForCollision) {
        if (target.state === 'crashed') continue;
        // Grounded-plane immunity — §10, T4.6. Position-based, NOT state-
        // based: any plane whose hitbox still touches the runway surface
        // (including the tangent-to-surface frame right after lift-off) is
        // bulletproof. Immunity ends the instant the hitbox leaves the
        // runway — §10 explicitly rules out a post-liftoff grace window.
        if (target.y + HITBOX.planeRadius >= WORLD.groundY) continue;
        const t = segmentCircleEntryT(
          b.prevX, b.prevY,
          b.x, b.y,
          target.x, target.y,
          HITBOX.planeRadius,
        );
        if (t < planeT) {
          planeT = t;
          hitTarget = target;
        }
      }

      if (towerT <= planeT && Number.isFinite(towerT)) {
        consumed = true; // tower blocked the round
      } else if (hitTarget !== undefined) {
        crashPlane(hitTarget, b.owner === hitTarget ? 'self-kill bullet' : 'bullet');
        consumed = true;
      }

      // Edge expiry — §10, T4.3. Bullets never wrap; they disappear at any
      // playfield boundary. Bottom edge is the runway surface (groundY), not
      // the full world height, so rounds can't travel through the HUD strip.
      // Checked after the plane collision so a single step that crosses both
      // a hitbox and an edge still registers the kill. The lifetime safety
      // cap below remains as a belt-and-braces backstop (§18 treats both as
      // tunable), but with finite non-zero speed it should never fire.
      if (!consumed) {
        if (
          b.x < 0 ||
          b.x >= WORLD.width ||
          b.y < 0 ||
          b.y >= WORLD.groundY
        ) {
          consumed = true;
        }
      }

      if (consumed || b.ageSec >= BULLETS.maxLifetimeSec) {
        bullets.splice(i, 1);
      }
    }

    // Match-end detection — §12. Ran after every crash source for the tick
    // has resolved (plane-plane ram + bullet hits) so simultaneous last-life
    // eliminations resolve as a draw rather than a race between kill sources.
    // 0 alive → draw; 1 alive → that plane wins; 2+ alive → keep playing.
    // `lives > 0` is the "still in match" predicate: a plane crashed with
    // lives > 0 is mid-respawn; a plane with lives = 0 is permanently out.
    let aliveCount = 0;
    let aliveIndex = -1;
    for (let i = 0; i < planes.length; i++) {
      if (planes[i]!.lives > 0) {
        aliveCount++;
        aliveIndex = i;
      }
    }
    if (aliveCount <= 1) {
      matchOver = true;
      matchOutcome =
        aliveCount === 0 ? 'draw' : aliveIndex === 0 ? 'P1' : 'P2';
      console.log(`[match] ${matchOutcome === 'draw' ? 'DRAW' : matchOutcome + ' WINS'}`);
    }
  }

  function render(): void {
    frameCount++;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.scale, viewport.scale);

    drawArena(ctx);
    for (const p of planes) {
      drawPlane(ctx, p);
      // Wrap-ghost: render a second copy at the opposite edge while the
      // sprite straddles the left/right boundary so the crossing looks
      // seamless (§8.5). Runway planes never straddle, so this is a no-op
      // for grounded planes but costs nothing to check.
      if (p.x < PLANE_SPRITE_EXTENT) {
        drawPlane(ctx, p, WORLD.width);
      } else if (p.x > WORLD.width - PLANE_SPRITE_EXTENT) {
        drawPlane(ctx, p, -WORLD.width);
      }
    }

    // Bullets render above planes so a round passing in front of a plane
    // reads correctly. Bullets don't wrap (§10) so no ghost pass.
    for (const b of bullets) drawBullet(ctx, b);

    ctx.fillStyle = '#fff';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Carnage v4.0 — T5.5 match end + play again', 32, 48);

    ctx.textAlign = 'right';
    ctx.fillText(`frames:    ${frameCount}`, WORLD.width - 32, 48);
    ctx.fillText(`sim steps: ${simSteps}`, WORLD.width - 32, 80);
    ctx.fillText(`sim time:  ${simTimeSec.toFixed(2)}s`, WORLD.width - 32, 112);
    ctx.fillText(`bullets:   ${bullets.length}`, WORLD.width - 32, 144);

    // Two per-plane diagnostic columns: P1 on the left (mirrors its runway
    // side), P2 on the right. Transient debug layout until T5.4 lands the
    // real HUD with lives + match state.
    function drawPlaneStats(label: string, p: Plane, x: number, align: CanvasTextAlign): void {
      ctx.textAlign = align;
      const headingDeg = (p.heading * 180) / Math.PI;
      const speedValue = Math.hypot(p.vx, p.vy);
      const altitude = WORLD.groundY - p.y;
      ctx.fillStyle = p.color;
      ctx.fillText(label, x, 224);
      ctx.fillStyle = '#fff';
      ctx.fillText(`state:     ${p.state}`, x, 256);
      ctx.fillText(`taxi:      ${p.taxiCommitted ? 'committed' : 'idle'}`, x, 288);
      ctx.fillText(`heading:   ${headingDeg.toFixed(1)}°`, x, 320);
      ctx.fillText(`speed:     ${speedValue.toFixed(1)} u/s`, x, 352);
      ctx.fillText(`altitude:  ${altitude.toFixed(0)}`, x, 384);
      if (p.state === 'crashed') {
        ctx.fillText(`respawn:   ${p.respawnTimerSec.toFixed(2)}s`, x, 416);
      } else if (p.state === 'grounded' && !p.taxiCommitted) {
        ctx.fillText(`auto-start:${p.autoStartTimerSec.toFixed(2)}s`, x, 416);
      }
    }
    drawPlaneStats('P1 (A/S/D)', plane1, 32, 'left');
    drawPlaneStats('P2 (J/K/L)', plane2, WORLD.width - 32, 'right');

    // Per-player lives in the bottom HUD strip — §7, §12, §16.3. Label +
    // row of pips, coloured with the plane's signature colour. Pips spread
    // away from the label, so lost lives fall off the far side and the
    // remaining count clusters near the player's identity label. Total pip
    // count is fixed at `MATCH.startingLives`; dim/outlined pips are lost,
    // solid pips are remaining.
    const hudCentreY = WORLD.groundY + WORLD.hudHeight / 2;
    function drawLivesHud(label: string, p: Plane, x: number, align: CanvasTextAlign): void {
      ctx.save();
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.color;
      ctx.fillText(label, x, hudCentreY);

      const labelPad = 120;
      const pipRadius = 10;
      const pipGap = 28;
      const dirSign = align === 'left' ? 1 : -1;
      const pipStartX = x + dirSign * labelPad;
      for (let i = 0; i < MATCH.startingLives; i++) {
        const cx = pipStartX + dirSign * i * pipGap;
        ctx.beginPath();
        ctx.arc(cx, hudCentreY, pipRadius, 0, Math.PI * 2);
        if (i < p.lives) {
          ctx.fillStyle = p.color;
          ctx.fill();
        } else {
          ctx.fillStyle = '#1a1a1a';
          ctx.fill();
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    drawLivesHud('P1', plane1, 32, 'left');
    drawLivesHud('P2', plane2, WORLD.width - 32, 'right');

    // Result overlay — §12, T5.5. Drawn last so it sits above planes,
    // bullets and HUD. Dim the sky (not the HUD strip — lives + bottom bar
    // stay legible so the player can see the final score), name the winner
    // in their signature colour, and show a Play Again button as the visual
    // affordance. Click anywhere on canvas OR Enter / Space restarts.
    if (matchOver) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, WORLD.width, WORLD.groundY);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const winMsg =
        matchOutcome === 'draw'
          ? 'DRAW'
          : `${matchOutcome} WINS`;
      const winColor =
        matchOutcome === 'P1' ? plane1.color
        : matchOutcome === 'P2' ? plane2.color
        : '#ffffff';
      ctx.fillStyle = winColor;
      ctx.font = 'bold 120px system-ui, sans-serif';
      ctx.fillText(winMsg, WORLD.width / 2, WORLD.height * 0.32);

      const btnW = 440;
      const btnH = 104;
      const btnX = WORLD.width / 2 - btnW / 2;
      const btnY = WORLD.height * 0.52;
      ctx.fillStyle = '#a89268';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = '#2a2014';
      ctx.lineWidth = STROKE.emphasis;
      ctx.strokeRect(btnX, btnY, btnW, btnH);
      ctx.fillStyle = '#2a2014';
      ctx.font = 'bold 56px system-ui, sans-serif';
      ctx.fillText('PLAY AGAIN', WORLD.width / 2, btnY + btnH / 2);

      ctx.fillStyle = '#e8e8e8';
      ctx.font = '28px system-ui, sans-serif';
      ctx.fillText(
        'click the button or press Enter / Space',
        WORLD.width / 2,
        btnY + btnH + 56,
      );
    }

    ctx.restore();
  }

  startLoop({ update, render });

  if (import.meta.env.DEV) {
    window.addEventListener('keydown', (ev) => {
      if (ev.key.toLowerCase() === 'x') {
        const start = performance.now();
        while (performance.now() - start < 1000) {
          /* intentional busy-wait */
        }
      }
    });
  }
}

init();
