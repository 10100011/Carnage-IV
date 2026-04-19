// Fixed-timestep game loop (T0.3).
//
// - Simulation advances in fixed steps at UPDATES_PER_SEC for deterministic physics.
// - Rendering happens once per animation frame at the browser's refresh rate.
// - The accumulator carries sub-step residue between frames.
// - Frame time is clamped to MAX_FRAME_TIME so a long stall (tab switch,
//   garbage-collection pause, an intentional synchronous spin) cannot trigger
//   an unbounded catch-up ("spiral of death"). At worst ~15 sim steps run in
//   one frame under the clamp.
//
// Canonical reference: https://gafferongames.com/post/fix_your_timestep/

const UPDATES_PER_SEC = 60;
const FIXED_DT = 1 / UPDATES_PER_SEC;
const MAX_FRAME_TIME_SEC = 0.25;

export interface LoopHandlers {
  /** Called zero or more times per animation frame with a fixed dt. */
  update: (dt: number) => void;
  /**
   * Called exactly once per animation frame.
   * `alpha` is the fractional sim step remaining in the accumulator (0..1);
   * useful for interpolating render state between fixed updates. Ignored for now.
   */
  render: (alpha: number) => void;
}

export function startLoop(handlers: LoopHandlers): void {
  let lastTimeSec = performance.now() / 1000;
  let accumulator = 0;

  function frame(nowMs: DOMHighResTimeStamp): void {
    const nowSec = nowMs / 1000;
    let frameTime = nowSec - lastTimeSec;
    if (frameTime > MAX_FRAME_TIME_SEC) frameTime = MAX_FRAME_TIME_SEC;
    lastTimeSec = nowSec;

    accumulator += frameTime;
    while (accumulator >= FIXED_DT) {
      handlers.update(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    const alpha = accumulator / FIXED_DT;
    handlers.render(alpha);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
