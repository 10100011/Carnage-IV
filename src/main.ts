import { drawArena } from './arena';
import {
  countBulletsOwnedBy,
  drawBullet,
  spawnBullet,
  type Bullet,
} from './bullet';
import { BULLETS, HITBOX, MATCH, PHYSICS, TOWER, WORLD } from './config';
import { startLoop } from './loop';
import {
  drawPlane,
  PLANE_NOSE_OFFSET,
  PLANE_SPRITE_EXTENT,
  type Plane,
} from './plane';

const TAU = Math.PI * 2;

/**
 * Minimum distance from a line-segment to a point, compared against a radius
 * — returns true iff the segment (a → b) passes within `radius` of the
 * circle centre (cx, cy). Used by the swept-segment bullet collision tests
 * (§9.7) so a bullet moving faster than a hitbox's diameter per tick can't
 * tunnel through. Strict `<` so tangent contact isn't a hit, matching the
 * crash conventions elsewhere.
 */
function segmentHitsCircle(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  radius: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let closestX: number;
  let closestY: number;
  if (lenSq === 0) {
    closestX = ax;
    closestY = ay;
  } else {
    const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lenSq));
    closestX = ax + t * dx;
    closestY = ay + t * dy;
  }
  const ex = closestX - cx;
  const ey = closestY - cy;
  return ex * ex + ey * ey < radius * radius;
}

/**
 * Does segment (a → b) intersect the axis-aligned rectangle? Liang-Barsky
 * parameter clipping — tests all four slabs and returns true iff the t-range
 * that satisfies every slab is non-empty. Used for the swept-segment bullet
 * vs tower test (§9.6, T4.5). Boundary touches count as hits (a round that
 * just grazes the tower should still be blocked).
 */
function segmentHitsAabb(
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

  // Single test plane spawns grounded on the innermost slot of the left
  // runway, facing the tower (§9.2, §11). Multi-plane placement and the
  // right-runway mirror land in T5.1 / T8.1. Slot math: each side's usable
  // length runs from the tower's inner edge out to the playfield edge, and
  // plane i of n sits at i/(n+1) of that length measured from the tower. For
  // n=1 on the left that's the midpoint between x=0 and the tower's left
  // face. y places the hitbox bottom exactly on the runway surface.
  //
  // `spawnSlot` is the pose used for *both* initial spawn and respawn after a
  // crash (T3.5 / §12). When T8.1 wires up per-plane slots this becomes a
  // per-plane value.
  const leftInnerEdge = TOWER.centreX - TOWER.width / 2;
  const spawnSlot = {
    x: leftInnerEdge * 0.5,
    y: WORLD.groundY - HITBOX.planeRadius,
    heading: Math.PI / 2,
  };
  const testPlane: Plane = {
    x: spawnSlot.x,
    y: spawnSlot.y,
    vx: 0,
    vy: 0,
    heading: spawnSlot.heading,
    state: 'grounded',
    taxiCommitted: false,
    respawnTimerSec: 0,
    autoStartTimerSec: MATCH.autoStartIdleSec,
    lastFireAtSec: Number.NEGATIVE_INFINITY,
    color: '#ffd27a',
  };

  // All live bullets fired by any plane. Per-plane cap (§10, T4.2) and
  // edge-expiry (T4.3) layer in next; for T4.1 the pool grows on fire and
  // shrinks only via the safety-lifetime sweep below.
  const bullets: Bullet[] = [];

  // Held-key map for input. Extracted to src/input.ts later (T5.2 P1/P2 mapping).
  const keys: Record<string, boolean> = {};
  // One-shot press edges collected between updates. Consumed (and cleared) by
  // update() so each physical press fires exactly one action, regardless of
  // OS auto-repeat or how many sim ticks run this frame.
  const pressedKeys = new Set<string>();
  window.addEventListener('keydown', (ev) => {
    if (!ev.repeat) pressedKeys.add(ev.key.toLowerCase());
    keys[ev.key] = true;
  });
  window.addEventListener('keyup', (ev) => {
    keys[ev.key] = false;
  });

  let frameCount = 0;
  let simSteps = 0;
  let simTimeSec = 0;

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
    console.log(
      `[crash] ${reason} at x=${plane.x.toFixed(0)}, y=${plane.y.toFixed(0)}, simTime=${simTimeSec.toFixed(2)}s`,
    );
  }

  function update(dt: number): void {
    simSteps++;
    simTimeSec += dt;

    // Respawn timer — §12, T3.5. Crashed planes sit motionless through the
    // 1.5 s explosion delay (T11.1 will hook its animation off this same
    // clock) and then reset to their runway slot, grounded and facing the
    // original direction. `taxiCommitted` is cleared so the next press must
    // re-commit, matching the §8.2.1 respawn-resets-the-state-machine rule.
    if (testPlane.state === 'crashed') {
      testPlane.respawnTimerSec -= dt;
      if (testPlane.respawnTimerSec <= 0) {
        testPlane.x = spawnSlot.x;
        testPlane.y = spawnSlot.y;
        testPlane.vx = 0;
        testPlane.vy = 0;
        testPlane.heading = spawnSlot.heading;
        testPlane.state = 'grounded';
        testPlane.taxiCommitted = false;
        testPlane.respawnTimerSec = 0;
        testPlane.autoStartTimerSec = MATCH.autoStartIdleSec;
        testPlane.lastFireAtSec = Number.NEGATIVE_INFINITY;
        console.log(`[respawn] simTime=${simTimeSec.toFixed(2)}s`);
      }
    }

    // Anti-camping auto-start — §11, T3.6. While the plane sits idle on the
    // runway with no taxi committed, count down from `autoStartIdleSec`. At
    // zero the sim commits the taxi itself; the player no longer gets a say,
    // and because the plane faces the tower that commit usually ends in a
    // crash. The T−2 s / T−1 s warning pulses are visual polish (T11.2) and
    // intentionally absent here.
    if (testPlane.state === 'grounded' && !testPlane.taxiCommitted) {
      testPlane.autoStartTimerSec -= dt;
      if (testPlane.autoStartTimerSec <= 0) {
        testPlane.taxiCommitted = true;
        testPlane.autoStartTimerSec = 0;
        console.log(`[auto-start] simTime=${simTimeSec.toFixed(2)}s`);
      }
    }

    // Rotation input. `[` = CCW, `]` = CW (T2.2 placeholders; A/D land in T5.2).
    // Grounded planes ignore rotation — they sit in their runway slot facing
    // the tower until the action button (below) commits the taxi (§11).
    //
    // While the hitbox is still tangent to the runway (airborne but not yet
    // climbed), rotation is clamped to the upper semicircle so the pilot
    // can't pitch the nose into the runway during takeoff. This is a quality-
    // of-life guard, not a prompt-mandated rule: §11's takeoff loop should be
    // a short learning curve, not pointless danger. Once the plane lifts any
    // distance above the surface, full 360° rotation returns.
    if (testPlane.state === 'airborne' || testPlane.state === 'stalled') {
      let rot = 0;
      if (keys['[']) rot -= 1;
      if (keys[']']) rot += 1;
      if (rot !== 0) {
        const newHeading =
          ((testPlane.heading + rot * PHYSICS.rotationRate * dt) % TAU + TAU) % TAU;
        const onRunway = testPlane.y + HITBOX.planeRadius >= WORLD.groundY;
        if (onRunway && Math.cos(newHeading) < 0) {
          // Nose would cross below horizontal while still on the runway —
          // snap to the nearer horizontal. Invariant: prevHeading is already
          // in the upper semicircle, so < π → clamp right (π/2), else left.
          testPlane.heading = testPlane.heading < Math.PI ? Math.PI / 2 : 3 * Math.PI / 2;
        } else {
          testPlane.heading = newHeading;
        }
      }
    }

    // Action button — one input, two meanings (§8.2.1). Uses `s` per §14.1
    // (P1 action); the P2 key `k` wires in at T5.2.
    //   grounded + !taxiCommitted → commit taxi (T3.3 applies the thrust).
    //   grounded +  taxiCommitted → ignored; a committed taxi cannot be aborted.
    //   airborne / stalled        → fire (edge press, plus held auto-fire
    //                               every BULLETS.autoFireIntervalSec).
    //   crashed                   → ignored.
    //
    // Stalled planes can still fire — §2 calls out the stall-to-fire-rearward
    // trick as a legitimate advanced tool. attemptFire() gates on the 2-
    // bullet cap (§10), spawns from the visible nose with no velocity
    // inheritance (§10), and records the fire time so the held auto-fire
    // loop below can pace itself.
    function attemptFire(): boolean {
      if (countBulletsOwnedBy(bullets, testPlane) >= BULLETS.maxPerPlane) {
        return false;
      }
      const noseX = testPlane.x + PLANE_NOSE_OFFSET * Math.sin(testPlane.heading);
      const noseY = testPlane.y - PLANE_NOSE_OFFSET * Math.cos(testPlane.heading);
      bullets.push(spawnBullet(noseX, noseY, testPlane.heading, testPlane));
      testPlane.lastFireAtSec = simTimeSec;
      return true;
    }

    const airborneFiringState =
      testPlane.state === 'airborne' || testPlane.state === 'stalled';

    if (pressedKeys.has('s')) {
      if (testPlane.state === 'grounded') {
        if (!testPlane.taxiCommitted) {
          testPlane.taxiCommitted = true;
          console.log(`[action] taxi committed at simTime=${simTimeSec.toFixed(2)}s`);
        }
      } else if (airborneFiringState) {
        attemptFire();
      }
    }
    pressedKeys.clear();

    // Held-auto-fire — action button held counts as 1 round per
    // `BULLETS.autoFireIntervalSec`, still subject to the 2-bullet count cap.
    // Edge presses above bypass the interval gate, so rapid tapping can drain
    // both rounds instantly; only the "hold the button and forget" case paces
    // itself at 1/s. Not in PROMPT.md §10 as of v4.3 — flagged at config.
    if (
      airborneFiringState &&
      keys['s'] &&
      simTimeSec - testPlane.lastFireAtSec >= BULLETS.autoFireIntervalSec
    ) {
      attemptFire();
    }

    if (testPlane.state === 'grounded' && testPlane.taxiCommitted) {
      // Runway taxi — §8.2, §11. Full-power acceleration along heading; the
      // plane is on the runway surface, so pitch coupling / gravity don't
      // apply. Drag is the only resistance, matching the airborne level-flight
      // formula with cos(heading)=0. Heading stays fixed at spawn value while
      // grounded (rotation input gated above), so vy stays 0 and y is
      // preserved on the runway surface. Lift-off fires when airspeed passes
      // liftOffThreshold — at that instant bullet-immunity also ends (§10),
      // which other modules key off `state !== 'grounded'` for free.
      const speed = Math.hypot(testPlane.vx, testPlane.vy);
      const accel = PHYSICS.thrust - PHYSICS.drag * speed;
      let newSpeed = speed + accel * dt;
      if (newSpeed < 0) newSpeed = 0;
      const dirX = Math.sin(testPlane.heading);
      const dirY = -Math.cos(testPlane.heading);
      testPlane.vx = newSpeed * dirX;
      testPlane.vy = newSpeed * dirY;

      if (newSpeed > PHYSICS.liftOffThreshold) {
        testPlane.state = 'airborne';
        testPlane.taxiCommitted = false;
      }
    } else if (testPlane.state === 'airborne') {
      // Airborne physics — §8.2, §8.3. Velocity stays aligned with heading.
      // Pitch coupling handles gravity's only effect while airborne:
      //   accel along heading = thrust − drag·speed − climbPenalty·g·cos(heading)
      const speed = Math.hypot(testPlane.vx, testPlane.vy);
      const accel =
        PHYSICS.thrust -
        PHYSICS.drag * speed -
        PHYSICS.climbPenaltyMultiplier * PHYSICS.gravity * Math.cos(testPlane.heading);
      let newSpeed = speed + accel * dt;
      if (newSpeed < 0) newSpeed = 0;
      if (newSpeed > PHYSICS.maxAirspeed) newSpeed = PHYSICS.maxAirspeed;

      const dirX = Math.sin(testPlane.heading);
      const dirY = -Math.cos(testPlane.heading);
      testPlane.vx = newSpeed * dirX;
      testPlane.vy = newSpeed * dirY;

      // Stall triggers — §8.4. Either condition drops the plane into stall
      // state; velocity is preserved by simply not touching vx/vy here, and
      // rotation keeps working because it's handled above the state branch.
      //   (a) airspeed falls below PHYSICS.stallThreshold
      //   (b) the plane enters the top-of-screen stall zone (§2.1 top 5%)
      if (
        newSpeed < PHYSICS.stallThreshold ||
        testPlane.y < WORLD.ceilingStallY
      ) {
        testPlane.state = 'stalled';
      }
    } else if (testPlane.state === 'stalled') {
      // Stalled — thrust disabled, gravity acts, drag continues. Rotation is
      // still under player control (handled above).
      const ax = -PHYSICS.drag * testPlane.vx;
      const ay = -PHYSICS.drag * testPlane.vy + PHYSICS.gravity;
      testPlane.vx += ax * dt;
      testPlane.vy += ay * dt;

      // Recovery — §8.4. Both must hold: nose pointing within tolerance of
      // straight-down (180°) AND airspeed above stallThreshold. The pilot's
      // job during stall is to dive to rebuild speed with the nose planted
      // down. On recovery the next airborne tick realigns velocity to heading.
      const pitchFromDown = Math.abs(testPlane.heading - Math.PI);
      const speedAfter = Math.hypot(testPlane.vx, testPlane.vy);
      if (
        pitchFromDown <= PHYSICS.stallRecoveryPitchTolerance &&
        speedAfter > PHYSICS.stallThreshold
      ) {
        testPlane.state = 'airborne';
      }
    }

    testPlane.x += testPlane.vx * dt;
    testPlane.y += testPlane.vy * dt;

    // Horizontal wrap — §8.5. Centre-based: when the plane's centre crosses
    // the left/right edge, teleport to the opposite edge; altitude, velocity
    // and heading are preserved. At PHYSICS.maxAirspeed * dt ≈ 11.7 u/frame,
    // a plane can't skip past a full WORLD.width (1920) in one step.
    if (testPlane.x < 0) testPlane.x += WORLD.width;
    else if (testPlane.x >= WORLD.width) testPlane.x -= WORLD.width;

    // Top-of-screen hard clamp (non-fatal). The ceiling stall triggers at
    // WORLD.ceilingStallY, but upward momentum can still carry a stalled
    // plane past y=0. Clamp centre at 0 and zero any remaining upward vy so
    // gravity takes over immediately. No crash — just a wall.
    if (testPlane.y < 0) {
      testPlane.y = 0;
      if (testPlane.vy < 0) testPlane.vy = 0;
    }

    // Tower collision — §9.6, §9.7. Plane circle vs tower AABB. Fires in any
    // non-crashed state: airborne/stalled flights into the side or top, and
    // the taxiing plane that runs out of runway before lift-off (the §11
    // auto-start punishment). Closest-point-on-AABB / squared-distance test
    // avoids a sqrt. Strict `<` so tangent contact isn't a crash — matches
    // the ground-crash convention introduced in T3.3.
    if (testPlane.state !== 'crashed') {
      const towerLeft = TOWER.centreX - TOWER.width / 2;
      const towerRight = TOWER.centreX + TOWER.width / 2;
      const cx = Math.max(towerLeft, Math.min(testPlane.x, towerRight));
      const cy = Math.max(TOWER.topY, Math.min(testPlane.y, WORLD.groundY));
      const dx = testPlane.x - cx;
      const dy = testPlane.y - cy;
      if (dx * dx + dy * dy < HITBOX.planeRadius * HITBOX.planeRadius) {
        crashPlane(testPlane, 'tower contact');
      }
    }

    // Ground crash — §9.8. Airborne or stalled plane whose hitbox penetrates
    // the runway surface crashes. Strict-`>` (not `>=`) so that the instant
    // after lift-off, when the hitbox is still tangent to the runway, the
    // plane doesn't immediately re-crash. A real dive into the ground still
    // fires the event on the next tick once y advances past the surface.
    // Fires the crash event once (state transitions to 'crashed'); subsequent
    // frames don't re-fire because physics is skipped in 'crashed' state.
    // Respawn / explosion animation land in T3.5 / T11.1.
    if (
      (testPlane.state === 'airborne' || testPlane.state === 'stalled') &&
      testPlane.y + HITBOX.planeRadius > WORLD.groundY
    ) {
      // Pin the wreck on the runway surface before the helper flips state —
      // ground crashes are the one site that needs a position fix-up (tower /
      // bullet leave the wreck wherever the impact happened).
      testPlane.y = WORLD.groundY - HITBOX.planeRadius;
      crashPlane(testPlane, 'ground contact');
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
    const planesForCollision: Plane[] = [testPlane];
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]!;
      b.prevX = b.x;
      b.prevY = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.ageSec += dt;

      let consumed = false;

      // Tower block — §9.6, §2, T4.5. Bullets stop on first contact with the
      // tower AABB. Checked before the plane test so a target hiding behind
      // the tower (low-altitude cover per §2) isn't shot through it.
      if (
        segmentHitsAabb(
          b.prevX, b.prevY,
          b.x, b.y,
          TOWER.centreX - TOWER.width / 2,
          TOWER.topY,
          TOWER.centreX + TOWER.width / 2,
          WORLD.groundY,
        )
      ) {
        consumed = true;
      }

      if (!consumed) {
        for (const target of planesForCollision) {
          if (target.state === 'crashed') continue;
          // Grounded-plane immunity — §10, T4.6. Position-based, NOT state-
          // based: any plane whose hitbox still touches the runway surface
          // (including the tangent-to-surface frame right after lift-off)
          // is bulletproof. Immunity ends the instant the hitbox leaves the
          // runway — §10 explicitly rules out a post-liftoff grace window.
          if (target.y + HITBOX.planeRadius >= WORLD.groundY) continue;
          if (
            segmentHitsCircle(
              b.prevX, b.prevY,
              b.x, b.y,
              target.x, target.y,
              HITBOX.planeRadius,
            )
          ) {
            crashPlane(target, b.owner === target ? 'self-kill bullet' : 'bullet');
            consumed = true;
            break;
          }
        }
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
  }

  function render(): void {
    frameCount++;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.scale, viewport.scale);

    drawArena(ctx);
    drawPlane(ctx, testPlane);
    // Wrap-ghost: render a second copy at the opposite edge while the sprite
    // straddles the left/right boundary, so the crossing is visually seamless.
    if (testPlane.x < PLANE_SPRITE_EXTENT) {
      drawPlane(ctx, testPlane, WORLD.width);
    } else if (testPlane.x > WORLD.width - PLANE_SPRITE_EXTENT) {
      drawPlane(ctx, testPlane, -WORLD.width);
    }

    // Bullets render above planes so a round passing in front of a plane
    // reads correctly. Bullets don't wrap (§10) so no ghost pass.
    for (const b of bullets) drawBullet(ctx, b);

    ctx.fillStyle = '#fff';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Carnage v4.0 — T4.6 grounded immunity', 32, 48);

    ctx.textAlign = 'right';
    const headingDeg = (testPlane.heading * 180) / Math.PI;
    const speedValue = Math.hypot(testPlane.vx, testPlane.vy);
    const altitude = WORLD.groundY - testPlane.y;
    ctx.fillText(`frames:    ${frameCount}`, WORLD.width - 32, 48);
    ctx.fillText(`sim steps: ${simSteps}`, WORLD.width - 32, 80);
    ctx.fillText(`sim time:  ${simTimeSec.toFixed(2)}s`, WORLD.width - 32, 112);
    ctx.fillText(`heading:   ${headingDeg.toFixed(1)}°`, WORLD.width - 32, 144);
    ctx.fillText(`speed:     ${speedValue.toFixed(1)} u/s`, WORLD.width - 32, 176);
    ctx.fillText(`altitude:  ${altitude.toFixed(0)}`, WORLD.width - 32, 208);
    ctx.fillText(`state:     ${testPlane.state}`, WORLD.width - 32, 240);
    ctx.fillText(`taxi:      ${testPlane.taxiCommitted ? 'committed' : 'idle'}`, WORLD.width - 32, 272);
    ctx.fillText(`bullets:   ${bullets.length}`, WORLD.width - 32, 336);
    if (testPlane.state === 'crashed') {
      ctx.fillText(`respawn:   ${testPlane.respawnTimerSec.toFixed(2)}s`, WORLD.width - 32, 304);
    } else if (testPlane.state === 'grounded' && !testPlane.taxiCommitted) {
      ctx.fillText(`auto-start: ${testPlane.autoStartTimerSec.toFixed(2)}s`, WORLD.width - 32, 304);
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
