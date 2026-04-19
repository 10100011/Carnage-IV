import { drawArena } from './arena';
import { PHYSICS, WORLD } from './config';
import { startLoop } from './loop';
import { drawPlane, PLANE_SPRITE_EXTENT, type Plane } from './plane';

const TAU = Math.PI * 2;

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

  // Test plane starts airborne at roughly cruise speed, heading east, so the
  // user can trigger a stall by pointing up (slows the plane until it drops
  // below PHYSICS.stallThreshold). Edit these fields to reposition.
  const testPlane: Plane = {
    x: WORLD.width * 0.3,
    y: WORLD.height * 0.4,
    vx: 600,
    vy: 0,
    heading: Math.PI / 2,
    state: 'airborne',
    color: '#ffd27a',
  };

  // Held-key map for input. Extracted to src/input.ts later (T5.2 P1/P2 mapping).
  const keys: Record<string, boolean> = {};
  window.addEventListener('keydown', (ev) => {
    keys[ev.key] = true;
  });
  window.addEventListener('keyup', (ev) => {
    keys[ev.key] = false;
  });

  let frameCount = 0;
  let simSteps = 0;
  let simTimeSec = 0;

  function update(dt: number): void {
    simSteps++;
    simTimeSec += dt;

    // Rotation input. `[` = CCW, `]` = CW (T2.2 placeholders; A/D land in T5.2).
    let rot = 0;
    if (keys['[']) rot -= 1;
    if (keys[']']) rot += 1;
    if (rot !== 0) {
      testPlane.heading += rot * PHYSICS.rotationRate * dt;
      testPlane.heading = ((testPlane.heading % TAU) + TAU) % TAU;
    }

    if (testPlane.state === 'airborne') {
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

    ctx.fillStyle = '#fff';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Carnage v4.0 — T2.8 stall recovery', 32, 48);

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
