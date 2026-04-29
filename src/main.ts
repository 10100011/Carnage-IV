import { drawArena } from './arena';
import {
  countBulletsOwnedBy,
  drawBullet,
  spawnBullet,
  type Bullet,
} from './bullet';
import { BULLETS, HITBOX, MATCH, PHYSICS, PLAYER_COLORS, PLAYERS, STROKE, TOWER, WORLD } from './config';
import {
  drawExplosions,
  spawnExplosion,
  spawnStallPuff,
  updateExplosions,
  type ExplosionParticle,
} from './explosion';
import { startLoop } from './loop';
import {
  drawPlane,
  PLANE_NOSE_OFFSET,
  PLANE_SPRITE_EXTENT,
  type Plane,
} from './plane';
import {
  AiPilot,
  AiPilotStub,
  type Pilot,
  type PilotInput,
  type World,
} from './pilot';

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

  // Spawn slot math per §9.2 (revised from i/(n+1) after playtest): planes
  // alternate sides as their global index increases — plane 1 left, plane
  // 2 right, plane 3 left, plane 4 right, ... Right-side planes face left
  // (heading 3π/2) with their sprite mirrored. Per-side slots are packed
  // near the outer runway edge with a fixed gap (see SPAWN_EDGE_PADDING /
  // SPAWN_SLOT_GAP) so no plane has noticeably less pre-tower runway than
  // another. Respawn picks the outermost free slot dynamically.
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

  /** Live plane roster. Rebuilt by `buildPlanes` at every match start. */
  const planes: Plane[] = [];

  /**
   * Spawn-slot packing toward the runway's outer edge. Outer slot 0 sits
   * `SPAWN_EDGE_PADDING` units from the playfield edge; subsequent slots
   * step inward by `SPAWN_SLOT_GAP`. Keeps the initial spread compact and
   * close to the outer edges so more central slots don't have noticeably
   * less usable runway before the tower — playtest feedback from the
   * previous §9.2 i/(n+1) layout showed the innermost planes felt
   * disadvantaged.
   */
  const SPAWN_EDGE_PADDING = 80;
  const SPAWN_SLOT_GAP = 100;

  /**
   * Per-side slot x-positions, outer-to-inner. Rebuilt every match by
   * `buildPlanes`. Respawn picks the outermost free slot so a lone
   * respawner always lands at the outer tip, while simultaneous respawns
   * naturally offset into adjacent slots.
   */
  let sideSlotsLeft: number[] = [];
  let sideSlotsRight: number[] = [];

  /**
   * Populate `planes` with `count` planes (§9.1, §9.2). Alternates left /
   * right as the global index climbs (plane 1 → left, plane 2 → right,
   * etc.), assigning each plane to the outermost unused slot on its side.
   * Mutates the shared `planes` array in place so existing references
   * (render loop, collisions, bullet owner pointers) remain valid across
   * matches.
   */
  function buildPlanes(count: number): void {
    planes.length = 0;
    const leftCount = Math.ceil(count / 2);
    const rightCount = Math.floor(count / 2);

    sideSlotsLeft = [];
    for (let i = 0; i < leftCount; i++) {
      sideSlotsLeft.push(SPAWN_EDGE_PADDING + i * SPAWN_SLOT_GAP);
    }
    sideSlotsRight = [];
    for (let i = 0; i < rightCount; i++) {
      sideSlotsRight.push(WORLD.width - SPAWN_EDGE_PADDING - i * SPAWN_SLOT_GAP);
    }

    let leftAssigned = 0;
    let rightAssigned = 0;
    for (let globalIdx = 0; globalIdx < count; globalIdx++) {
      const isLeft = globalIdx % 2 === 0;
      const color = PLAYER_COLORS[globalIdx] ?? '#ffffff';
      if (isLeft) {
        const x = sideSlotsLeft[leftAssigned]!;
        leftAssigned++;
        planes.push(makeGroundedPlane({ x, heading: Math.PI / 2, color, mirror: false }));
      } else {
        const x = sideSlotsRight[rightAssigned]!;
        rightAssigned++;
        planes.push(makeGroundedPlane({ x, heading: (3 * Math.PI) / 2, color, mirror: true }));
      }
    }
  }

  /**
   * Pick the outermost slot on `plane`'s runway side that isn't occupied
   * by another non-taxiing plane. "Occupied" means another plane is sat
   * at that x in the `grounded` state — a plane that's already taxiing
   * has moved off its spawn slot, so its original slot is available.
   * Returns the slot x. Falls back to the innermost slot if all are
   * taken (shouldn't happen with one slot per plane).
   */
  function pickRespawnSlotX(plane: Plane): number {
    const slots = plane.spawn.x < WORLD.width / 2 ? sideSlotsLeft : sideSlotsRight;
    for (const x of slots) {
      let taken = false;
      for (const other of planes) {
        if (other === plane) continue;
        if (other.state !== 'grounded') continue;
        if (Math.abs(other.x - x) < 2) {
          taken = true;
          break;
        }
      }
      if (!taken) return x;
    }
    return slots[slots.length - 1] ?? plane.spawn.x;
  }

  // Mobile / touch support — §6, §14.2, Phase 10. Browsers don't expose a
  // clean "is this a touch device" signal, but the intersection of no-mouse
  // + touch-points-available is a reliable heuristic. We gate the portrait
  // overlay and virtual-button rendering on this so desktop users in a
  // narrow window don't get the "rotate your device" screen.
  const isTouchDevice =
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  canvas.style.touchAction = 'none';

  function isPortraitOrientation(): boolean {
    if (!isTouchDevice) return false;
    return window.innerHeight > window.innerWidth;
  }

  /** Map a client-pixel coordinate to a logical-playfield coordinate. */
  function screenToLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const screenX = (clientX - rect.left) * (canvas.width / rect.width);
    const screenY = (clientY - rect.top) * (canvas.height / rect.height);
    return {
      x: (screenX - viewport.offsetX) / viewport.scale,
      y: (screenY - viewport.offsetY) / viewport.scale,
    };
  }

  // Virtual-button layout for mobile play (§14.2). Six buttons total —
  // three per player, laid out along the bottom of the playfield so both
  // players can reach their own set in landscape. Positioned above the
  // HUD strip so life pips stay readable; translucent fill in render so
  // any planes briefly flying through the lower-playfield stay visible.
  type TouchControl =
    | 'p1-ccw' | 'p1-action' | 'p1-cw'
    | 'p2-ccw' | 'p2-action' | 'p2-cw';

  interface VirtualButton {
    control: TouchControl;
    x: number;
    y: number;
    radius: number;
    player: 1 | 2;
  }

  const VBTN_Y = WORLD.height - 220;
  const VBTN_ROT_R = 80;
  const VBTN_ACTION_R = 100;
  const VBTN_GAP = 40;
  const VBTN_EDGE = 70;
  const VIRTUAL_BUTTONS: readonly VirtualButton[] = [
    // P1 — left half, left-to-right: CCW · action · CW.
    { control: 'p1-ccw', player: 1, x: VBTN_EDGE + VBTN_ROT_R, y: VBTN_Y, radius: VBTN_ROT_R },
    { control: 'p1-action', player: 1, x: VBTN_EDGE + VBTN_ROT_R * 2 + VBTN_GAP + VBTN_ACTION_R, y: VBTN_Y, radius: VBTN_ACTION_R },
    { control: 'p1-cw', player: 1, x: VBTN_EDGE + VBTN_ROT_R * 2 + VBTN_GAP * 2 + VBTN_ACTION_R * 2 + VBTN_ROT_R, y: VBTN_Y, radius: VBTN_ROT_R },
    // P2 — right half, mirror.
    { control: 'p2-cw', player: 2, x: WORLD.width - (VBTN_EDGE + VBTN_ROT_R), y: VBTN_Y, radius: VBTN_ROT_R },
    { control: 'p2-action', player: 2, x: WORLD.width - (VBTN_EDGE + VBTN_ROT_R * 2 + VBTN_GAP + VBTN_ACTION_R), y: VBTN_Y, radius: VBTN_ACTION_R },
    { control: 'p2-ccw', player: 2, x: WORLD.width - (VBTN_EDGE + VBTN_ROT_R * 2 + VBTN_GAP * 2 + VBTN_ACTION_R * 2 + VBTN_ROT_R), y: VBTN_Y, radius: VBTN_ROT_R },
  ];

  /** Control → synthetic keyboard key mapping (matches §14.1 desktop bindings). */
  const TOUCH_CONTROL_KEY: Record<TouchControl, string> = {
    'p1-ccw': 'a',
    'p1-action': 's',
    'p1-cw': 'd',
    'p2-ccw': 'j',
    'p2-action': 'k',
    'p2-cw': 'l',
  };

  /** touch.identifier → (control, associated key) while the finger is down. */
  const activeTouches = new Map<number, TouchControl>();
  /** Which virtual buttons are currently held — drives the render highlight. */
  const pressedVirtualButtons = new Set<TouchControl>();

  function hitTestVirtualButton(x: number, y: number): TouchControl | null {
    for (const btn of VIRTUAL_BUTTONS) {
      const dx = x - btn.x;
      const dy = y - btn.y;
      if (dx * dx + dy * dy < btn.radius * btn.radius) return btn.control;
    }
    return null;
  }

  function applyTouchControl(control: TouchControl, active: boolean): void {
    const key = TOUCH_CONTROL_KEY[control];
    if (active) {
      keys[key] = true;
      pressedVirtualButtons.add(control);
      if (control === 'p1-action' || control === 'p2-action') {
        // Action buttons need an edge press for taxi commit + single-tap
        // fire. Human pilot reads `pressedKeys` once per update tick.
        pressedKeys.add(key);
      }
    } else {
      keys[key] = false;
      pressedVirtualButtons.delete(control);
    }
  }

  // All live bullets fired by any plane. Per-plane cap (§10, T4.2) and
  // edge-expiry (T4.3) layer in next; for T4.1 the pool grows on fire and
  // shrinks only via the safety-lifetime sweep below.
  const bullets: Bullet[] = [];

  // Crash-explosion particles (T11.1, §5 Build Phases). Spawned by
  // `crashPlane`, aged in the update loop, drawn in render. The list is
  // shared across all planes; particles self-expire well within the §12
  // 1.5 s respawn window so smoke never outlives the wreck.
  const explosions: ExplosionParticle[] = [];

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
    // UI shortcuts for Enter / Space on screens that freeze the sim.
    //   setup screen  → Start a match (only when the combo is valid).
    //   result screen → Return to setup (§13.3 "play again" re-enters setup).
    // Handled before the key-tracking path so these presses don't linger
    // as stale state for the next match.
    if (k === 'enter' || k === ' ') {
      if (gameState === 'setup') {
        ev.preventDefault();
        if (setupIsValid()) startMatch();
        return;
      }
      if (matchOver) {
        ev.preventDefault();
        exitToSetup();
        return;
      }
    }
    if (!ev.repeat) pressedKeys.add(k);
    keys[k] = true;
  });
  window.addEventListener('keyup', (ev) => {
    keys[ev.key.toLowerCase()] = false;
  });
  // Shared tap handler for UI screens — click and touchstart both route
  // here so the setup + result screens work identically on mouse and
  // touch. Mid-match taps on virtual buttons are handled separately in
  // the touch handler before falling through here.
  function handleUITap(logicalX: number, logicalY: number): void {
    if (gameState === 'setup') {
      for (const v of [1, 2] as const) {
        if (hitTestButton(logicalX, logicalY, humansBtnRect(v))) {
          setHumansChoice(v);
          return;
        }
      }
      for (let v = 0; v <= 7; v++) {
        if (aiCountDisabled(v)) continue;
        if (hitTestButton(logicalX, logicalY, aiBtnRect(v))) {
          setupAi = v;
          return;
        }
      }
      for (const d of ['easy', 'medium', 'hard'] as const) {
        if (difficultyDisabled(d)) continue;
        if (hitTestButton(logicalX, logicalY, difficultyBtnRect(d))) {
          setupDifficulty = d;
          return;
        }
      }
      if (setupIsValid() && hitTestButton(logicalX, logicalY, SETUP_START_BUTTON)) {
        startMatch();
      }
      return;
    }
    if (matchOver) {
      if (hitTestButton(logicalX, logicalY, RESULT_PLAY_AGAIN_BUTTON)) exitToSetup();
      return;
    }
    // Skip-to-result tap (§12, T11.4) — only registers while the button
    // is actually rendered (humans all out, match still live).
    if (
      gameState === 'match' &&
      humansAllEliminated() &&
      hitTestButton(logicalX, logicalY, SKIP_TO_RESULT_BUTTON)
    ) {
      skipToResult();
    }
  }

  canvas.addEventListener('click', (ev) => {
    const { x, y } = screenToLogical(ev.clientX, ev.clientY);
    handleUITap(x, y);
  });

  // Touch handlers — §14.2, T10.2/T10.3/T10.4/T10.5. Mid-match, each touch
  // is bound at start to whichever virtual button it landed on and stays
  // bound to that control until the finger lifts. Setup / result screen
  // taps route through `handleUITap` just like clicks.
  canvas.addEventListener('touchstart', (ev) => {
    ev.preventDefault();
    // Block every tap while the rotate-device overlay is up — the user
    // can't see the UI behind it, so interacting with it would surprise.
    if (isPortraitOrientation()) return;
    for (let i = 0; i < ev.changedTouches.length; i++) {
      const t = ev.changedTouches[i]!;
      const { x, y } = screenToLogical(t.clientX, t.clientY);
      if (gameState === 'match' && !matchOver) {
        const control = hitTestVirtualButton(x, y);
        if (control !== null) {
          activeTouches.set(t.identifier, control);
          applyTouchControl(control, true);
          continue;
        }
      }
      handleUITap(x, y);
    }
  }, { passive: false });

  function releaseTouch(identifier: number): void {
    const control = activeTouches.get(identifier);
    if (control !== undefined) {
      applyTouchControl(control, false);
      activeTouches.delete(identifier);
    }
  }
  canvas.addEventListener('touchend', (ev) => {
    ev.preventDefault();
    for (let i = 0; i < ev.changedTouches.length; i++) {
      releaseTouch(ev.changedTouches[i]!.identifier);
    }
  }, { passive: false });
  canvas.addEventListener('touchcancel', (ev) => {
    ev.preventDefault();
    for (let i = 0; i < ev.changedTouches.length; i++) {
      releaseTouch(ev.changedTouches[i]!.identifier);
    }
  }, { passive: false });

  // Per-plane pilot assignment, index-aligned with `planes` (§15.1). Every
  // plane that participates in the sim has a pilot — humans wrap the
  // keyboard via `makeHumanPilot`, AI implementations live in src/pilot.ts.
  // URL param `?p2=ai` swaps P2 to the T6.1 AI stub without editing code;
  // default stays human so keyboard play is undisturbed. Phase 7's setup
  // screen will replace this with UI-driven assignment.
  interface KeyBindings {
    ccw: string;
    action: string;
    cw: string;
  }
  function makeHumanPilot(bindings: KeyBindings): Pilot {
    const label = `${bindings.ccw.toUpperCase()}/${bindings.action.toUpperCase()}/${bindings.cw.toUpperCase()}`;
    return {
      label,
      kind: 'human',
      update(): PilotInput {
        const ccwDown = keys[bindings.ccw] === true;
        const cwDown = keys[bindings.cw] === true;
        return {
          rotate: ccwDown && !cwDown ? -1 : !ccwDown && cwDown ? 1 : 0,
          actionPress: pressedKeys.has(bindings.action),
          actionHold: keys[bindings.action] === true,
        };
      },
    };
  }
  // Live pilot roster, index-aligned with `planes`. Populated by
  // `assignPilots` / `assignPilotsFromUrl` as matches begin.
  const pilots: Array<Pilot | null> = [];

  const params = new URLSearchParams(window.location.search);
  const p1UrlMode = (params.get('p1') ?? '').toLowerCase();
  const p2UrlMode = (params.get('p2') ?? '').toLowerCase();
  // Dev back-door: if any URL pilot flag is set, bypass setup and start
  // immediately as a 2-plane match with URL-driven pilots. Primarily for
  // AI-vs-AI observation (T6.3 acceptance).
  const skipSetupViaUrl = params.has('p1') || params.has('p2');
  const world: World = { planes, bullets };

  let frameCount = 0;
  let simSteps = 0;
  let simTimeSec = 0;

  // Top-level game state — §13. Setup screen precedes every match; the match
  // freezes on end (existing §12 behaviour) and the result screen's Play
  // Again button drops back to setup per §13.3 rather than starting a new
  // match in place. URL pilot override bypasses setup entirely.
  let gameState: 'setup' | 'match' = skipSetupViaUrl ? 'match' : 'setup';

  // Setup selectors — §13.1, T7.2. Defaults per §13.3: 1 human + 1 medium
  // AI. Session persistence (§13.3, T7.5) is free here because these vars
  // live in init()'s closure — they're only mutated by user clicks in the
  // setup handler, and never reset by `resetMatch`, `exitToSetup`, or
  // `startMatch`. Play Again → exitToSetup → renderSetup reads the same
  // values the player last picked. Page reload starts fresh per spec
  // (no cross-session storage in v1). The interim plane-count cap is 2
  // until T8 scales N-plane support; selector values that would exceed
  // the cap are shown greyed (per §5 interim-build note) and Start is
  // disabled when the combination is out of range.
  type Difficulty = 'easy' | 'medium' | 'hard';
  let setupHumans: 1 | 2 = 1;
  let setupAi = 1;
  let setupDifficulty: Difficulty = 'medium';

  const MAX_TOTAL_PLANES_CURRENT = PLAYERS.maxPerMatch; // §9.1, raised from 2 at T8.1
  const MIN_TOTAL_PLANES = PLAYERS.minPerMatch;

  function setupTotalPlanes(): number {
    return setupHumans + setupAi;
  }
  function setupIsValid(): boolean {
    const t = setupTotalPlanes();
    return t >= MIN_TOTAL_PLANES && t <= MAX_TOTAL_PLANES_CURRENT;
  }
  function aiCountDisabled(v: number): boolean {
    const t = setupHumans + v;
    return t < MIN_TOTAL_PLANES || t > MAX_TOTAL_PLANES_CURRENT;
  }
  function difficultyDisabled(_d: Difficulty): boolean {
    // All three tiers wired as of T9. Kept as a helper so Phase 7's
    // setup UI can still grey tiers out in interim builds if future
    // changes need to re-gate any of them.
    return false;
  }

  /** Collision-mode descriptor for a given plane count — §9.3 / §13.2. */
  function collisionModeFor(count: number): {
    name: string;
    rule: string;
    explanation: string;
  } {
    if (count >= PLAYERS.dogfightModeMinPlanes) {
      return {
        name: 'Dogfight',
        rule: 'Bullets Only',
        explanation: 'Planes pass through each other. Only bullets kill.',
      };
    }
    return {
      name: 'Close Quarters',
      rule: 'Ramming ON',
      explanation: 'Mid-air collisions destroy both planes.',
    };
  }
  function setHumansChoice(h: 1 | 2): void {
    setupHumans = h;
    // Clamp AI count back into valid range — avoids stale invalid combo
    // lingering after the user edits humans.
    const minValid = Math.max(0, MIN_TOTAL_PLANES - h);
    const maxValid = Math.max(0, MAX_TOTAL_PLANES_CURRENT - h);
    if (setupAi < minValid) setupAi = minValid;
    if (setupAi > maxValid) setupAi = maxValid;
  }

  // Selector button rect helpers — positions derived relative to the
  // Controls panel (x=320, y=340, w=560, h=380). All share a common
  // x-center at 600 (panel midpoint).
  function humansBtnRect(v: 1 | 2): ButtonRect {
    return { x: 510 + (v - 1) * 100, y: 395, w: 80, h: 50 };
  }
  function aiBtnRect(v: number): ButtonRect {
    return { x: 365 + v * 60, y: 495, w: 50, h: 50 };
  }
  function difficultyBtnRect(d: Difficulty): ButtonRect {
    const idx = d === 'easy' ? 0 : d === 'medium' ? 1 : 2;
    return { x: 410 + idx * 130, y: 600, w: 120, h: 50 };
  }

  function makeAiPilotForDifficulty(d: Difficulty): Pilot {
    return new AiPilot(d);
  }

  /**
   * Populate `pilots` to match `planes.length`. Slot 0 is always P1
   * keyboard (A/S/D). Slot 1 becomes P2 keyboard (J/K/L) when
   * `setupHumans === 2`, otherwise AI. Slots 2+ are always AI per the
   * current `setupDifficulty` tier (§14.1 / §15).
   */
  function assignPilots(): void {
    pilots.length = 0;
    for (let i = 0; i < planes.length; i++) {
      if (i === 0) {
        pilots.push(makeHumanPilot({ ccw: 'a', action: 's', cw: 'd' }));
      } else if (i === 1 && setupHumans === 2) {
        pilots.push(makeHumanPilot({ ccw: 'j', action: 'k', cw: 'l' }));
      } else {
        pilots.push(makeAiPilotForDifficulty(setupDifficulty));
      }
    }
  }

  /** URL-override pilot set used by the dev back-door (two-plane match). */
  function assignPilotsFromUrl(): void {
    pilots.length = 0;
    const p1Pilot: Pilot =
      p1UrlMode === 'ai' ? new AiPilot('medium')
      : p1UrlMode === 'ai-stub' ? new AiPilotStub()
      : makeHumanPilot({ ccw: 'a', action: 's', cw: 'd' });
    const p2Pilot: Pilot =
      p2UrlMode === 'human' ? makeHumanPilot({ ccw: 'j', action: 'k', cw: 'l' })
      : p2UrlMode === 'ai-stub' ? new AiPilotStub()
      : new AiPilot('medium');
    pilots.push(p1Pilot, p2Pilot);
  }

  // Match lifecycle — §12. `matchOver` freezes the sim and shows the result
  // screen. `matchOutcome` is either a winning plane index or a draw token
  // (simultaneous last-life eliminations). Cleared by `resetMatch` when the
  // player hits Start. Collision mode (§9.3) is determined at match start
  // from the plane count and fixed for the match's duration.
  let matchOver = false;
  type MatchOutcome = { kind: 'draw' } | { kind: 'winner'; index: number };
  let matchOutcome: MatchOutcome | null = null;
  let matchMode: 'closeQuarters' | 'dogfight' = 'closeQuarters';
  let matchStartBannerRemainingSec = 0;

  /**
   * Shared button-rect record so render, hit-test, and keyboard shortcuts
   * agree on where each clickable lives. Logical coordinates (pre-viewport
   * transform); the click handler maps screen → logical before testing.
   */
  interface ButtonRect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const SETUP_START_BUTTON: ButtonRect = {
    x: WORLD.width / 2 - 220,
    y: WORLD.height * 0.78,
    w: 440,
    h: 104,
  };
  const RESULT_PLAY_AGAIN_BUTTON: ButtonRect = {
    x: WORLD.width / 2 - 220,
    y: WORLD.height * 0.52,
    w: 440,
    h: 104,
  };
  /**
   * Skip-to-result button — §12, T11.4. Surfaces only when every human
   * pilot in the match is permanently eliminated and AI continue to fight.
   * Top-centre of the playfield so it doesn't clash with the bottom HUD or
   * the per-plane debug stat columns. Width / height tuned to be obvious
   * without dominating the screen — this is an opt-out, not the default.
   */
  const SKIP_TO_RESULT_BUTTON: ButtonRect = {
    x: WORLD.width / 2 - 220,
    y: 130,
    w: 440,
    h: 80,
  };

  function hitTestButton(logicalX: number, logicalY: number, btn: ButtonRect): boolean {
    return (
      logicalX >= btn.x &&
      logicalX <= btn.x + btn.w &&
      logicalY >= btn.y &&
      logicalY <= btn.y + btn.h
    );
  }

  // Bootstrap planes + pilots — either URL-driven 2-plane match or the
  // default 2-plane state the setup screen starts from. The setup UI's
  // Start handler rebuilds both arrays to match its selections.
  if (skipSetupViaUrl) {
    buildPlanes(2);
    assignPilotsFromUrl();
    // Arm the §9.4 match-start banner on the dev back-door path too so
    // behaviour is consistent with Start-from-setup.
    matchStartBannerRemainingSec = MATCH.modeBannerSec;
  } else {
    buildPlanes(setupTotalPlanes());
    assignPilots();
  }
  matchMode = planes.length >= PLAYERS.dogfightModeMinPlanes ? 'dogfight' : 'closeQuarters';
  console.log(
    `[init] planes=${planes.length} · mode=${matchMode} · P1=${pilots[0]?.label ?? '—'} · P2=${pilots[1]?.label ?? '—'}${skipSetupViaUrl ? ' (URL override — skipping setup)' : ''}`,
  );

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
    explosions.length = 0;
    // Flush any input collected while the result / setup screen was up so
    // it can't bleed into the first tick of the new match (held rotation
    // keys, a stray taxi-commit press during result-screen fiddling, etc.).
    pressedKeys.clear();
    for (const k of Object.keys(keys)) delete keys[k];
    matchOver = false;
    matchOutcome = null;
    console.log('[match] reset — new match');
  }

  /**
   * `true` while at least one human pilot was assigned this match and every
   * such plane is permanently out (lives ≤ 0). Drives the §12 / T11.4 skip-
   * to-result button. AI-only matches (humans = 0) never trigger — the
   * button has no audience there.
   */
  function humansAllEliminated(): boolean {
    let humanCount = 0;
    for (let i = 0; i < pilots.length; i++) {
      if (pilots[i]?.kind !== 'human') continue;
      humanCount++;
      if (planes[i]!.lives > 0) return false;
    }
    return humanCount > 0;
  }

  /**
   * §12 skip-to-result: end the AI-vs-AI continuation immediately and
   * declare the AI currently leading in lives the winner. Tie at the top
   * → draw. Per the spec this is an explicit *approximation* — we do not
   * simulate who'd actually have prevailed had play continued.
   *
   * Idempotent if matchOver is already set; the button only renders while
   * the match is live, but a same-tick double-click could still arrive.
   */
  function skipToResult(): void {
    if (matchOver) return;
    let topLives = -1;
    let topIndex = -1;
    let tiedAtTop = false;
    for (let i = 0; i < planes.length; i++) {
      if (pilots[i]?.kind !== 'ai') continue;
      if (planes[i]!.lives <= 0) continue;
      const lives = planes[i]!.lives;
      if (lives > topLives) {
        topLives = lives;
        topIndex = i;
        tiedAtTop = false;
      } else if (lives === topLives) {
        tiedAtTop = true;
      }
    }
    matchOver = true;
    matchOutcome =
      topIndex < 0 || tiedAtTop
        ? { kind: 'draw' }
        : { kind: 'winner', index: topIndex };
    console.log(
      `[match] skip-to-result → ${matchOutcome.kind === 'draw' ? 'DRAW' : `P${matchOutcome.index + 1} WINS`} (lives leader)`,
    );
  }

  function startMatch(): void {
    // Rebuild the plane roster and pilots from the current setup choices
    // (§13). Collision mode (§9.3) is fixed here for the match's duration
    // based on total plane count. The match-start mode banner (§9.4) fires
    // on every entry so the active rule is unambiguous.
    buildPlanes(setupTotalPlanes());
    assignPilots();
    matchMode = setupTotalPlanes() >= PLAYERS.dogfightModeMinPlanes ? 'dogfight' : 'closeQuarters';
    matchStartBannerRemainingSec = MATCH.modeBannerSec;
    resetMatch();
    gameState = 'match';
  }

  function exitToSetup(): void {
    gameState = 'setup';
    // Planes stay wherever they ended up — setup screen draws over them.
    // `startMatch` resets when the player clicks Start again.
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
    if (plane.state === 'crashed' || plane.state === 'eliminated') return;
    plane.state = 'crashed';
    plane.vx = 0;
    plane.vy = 0;
    plane.taxiCommitted = false;
    plane.respawnTimerSec = MATCH.respawnDelaySec;
    plane.lives -= 1;
    spawnExplosion(explosions, plane.x, plane.y, plane.color);
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
      // Permanently out (§12). Transition to `eliminated` so render and
      // collision loops drop the plane — no lingering wreck.
      p.state = 'eliminated';
      p.respawnTimerSec = 0;
      return;
    }
    // Dynamic respawn slot: outermost free slot on this plane's side.
    // Simultaneous respawns naturally offset because the first to respawn
    // this tick goes to slot 0 and its state flips to `grounded`, which
    // the next respawner then sees as taken.
    p.x = pickRespawnSlotX(p);
    p.y = p.spawn.y;
    p.vx = 0;
    p.vy = 0;
    p.heading = p.spawn.heading;
    p.state = 'grounded';
    p.taxiCommitted = false;
    p.respawnTimerSec = 0;
    p.autoStartTimerSec = MATCH.autoStartIdleSec;
    p.lastFireAtSec = Number.NEGATIVE_INFINITY;
    console.log(`[respawn] x=${p.x.toFixed(0)} simTime=${simTimeSec.toFixed(2)}s`);
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
   * Apply a pilot's per-tick input to its plane. Same code path for humans
   * (keyboard-wrapped inputs) and AI (computed inputs), so every state
   * transition — rotation clamps (§8.1, §11 on-runway guard), taxi commit
   * (§8.2.1), fire cap + held auto-fire — is identical regardless of pilot.
   *
   * Rotation (§8.1, §14.1): active in airborne / stalled only. Grounded
   * planes ignore rotation — they face the tower until the action button
   * commits the taxi (§11). On-runway tangent frame is clamped to the
   * upper semicircle so a pilot can't pitch into the runway during lift-
   * off (quality-of-life guard, not prompt-mandated).
   *
   * Action button (§8.2.1):
   *   grounded + !taxiCommitted → commit taxi (stepPhysics applies thrust).
   *   grounded +  taxiCommitted → ignored; a committed taxi can't be aborted.
   *   airborne / stalled        → edge press fires; hold auto-fires every
   *                               BULLETS.autoFireIntervalSec.
   *   crashed                   → ignored.
   *
   * Stalled planes can still fire — §2 calls out the stall-to-fire-rearward
   * trick as a legitimate advanced tool. Edge presses bypass the interval
   * gate so rapid tapping can drain both rounds instantly; `attemptFire`
   * updates `lastFireAtSec` so the held check here won't double-fire.
   */
  function applyInput(p: Plane, input: PilotInput, dt: number): void {
    if (
      input.rotate !== 0 &&
      (p.state === 'airborne' || p.state === 'stalled')
    ) {
      const newHeading =
        ((p.heading + input.rotate * PHYSICS.rotationRate * dt) % TAU + TAU) % TAU;
      const onRunway = p.y + HITBOX.planeRadius >= WORLD.groundY;
      if (onRunway && Math.cos(newHeading) < 0) {
        p.heading = p.heading < Math.PI ? Math.PI / 2 : 3 * Math.PI / 2;
      } else {
        p.heading = newHeading;
      }
    }

    const firing = p.state === 'airborne' || p.state === 'stalled';
    if (input.actionPress) {
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
      input.actionHold &&
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
    if (p.state !== 'crashed' && p.state !== 'eliminated') {
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
    // The sim only runs while a match is actively being played AND the
    // device is in landscape (§6). Setup, match-over, and portrait-on-
    // mobile all early-return — their screens are rendered on top of the
    // frozen frame and input is routed to the UI, not the plane physics.
    if (gameState === 'setup' || isPortraitOrientation()) return;
    // Crash-explosion particles tick even after matchOver so a final-life
    // crash isn't frozen mid-burst on the result overlay (T11.1).
    updateExplosions(explosions, dt);
    if (matchOver) return;
    simSteps++;
    simTimeSec += dt;

    // Match-start banner countdown (§9.4, T8.4). Independent of the match
    // physics loop — ticks even while crashed planes are respawning.
    if (matchStartBannerRemainingSec > 0) {
      matchStartBannerRemainingSec = Math.max(0, matchStartBannerRemainingSec - dt);
    }

    // Time-based triggers (both planes) before inputs fire, so a respawning
    // plane's state is already 'grounded' by the time input runs this tick.
    for (const p of planes) {
      handleRespawn(p, dt);
      handleAutoStart(p, dt);
    }

    // Pilot input, one plane per assigned pilot. Every pilot's update()
    // reads `pressedKeys` before the shared clear below, so same-tick
    // presses get their edge seen by each plane's human pilot exactly once;
    // AI pilots don't observe keyboard state at all.
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i]!;
      const pilot = pilots[i];
      if (!pilot) continue;
      const input = pilot.update(p, world, dt);
      applyInput(p, input, dt);
    }
    pressedKeys.clear();

    // Per-plane physics + environment collisions.
    for (const p of planes) stepPhysics(p, dt);

    // Stall smoke (T11.3). Each stalled plane emits puffs from its tail at
    // ~STALL_SMOKE_RATE puffs/sec via the standard rate-trial. Tail offset
    // mirrors the nose offset used for bullet spawn so smoke trails behind
    // the airframe regardless of facing.
    const STALL_SMOKE_RATE = 22;
    const tailDist = PLANE_NOSE_OFFSET * 0.6;
    for (const p of planes) {
      if (p.state !== 'stalled') continue;
      if (Math.random() >= dt * STALL_SMOKE_RATE) continue;
      const tx = p.x - Math.sin(p.heading) * tailDist;
      const ty = p.y + Math.cos(p.heading) * tailDist;
      spawnStallPuff(explosions, tx, ty);
    }

    // Plane-plane mid-air collision — §9.3, §9.5. Close Quarters mode
    // (≤ 4 planes) crashes both participants on any in-air hitbox overlap;
    // Dogfight mode (≥ 5 planes, T8.3) suppresses the crash entirely —
    // planes pass through each other and only bullets kill, with the
    // ghost-through visual (T8.5) signalling it. §9.5: planes on the
    // runway don't collide either way, so taxi stacking is allowed.
    //
    // At max airspeed (700 u/s) the per-tick relative motion between a
    // pair is ≤ 2·(700·dt) ≈ 23 u, well under 2·planeRadius = 40 u, so a
    // static end-of-tick circle-circle test catches every overlap without
    // a swept capsule.
    if (matchMode === 'closeQuarters') {
      const minRamDistSq = (2 * HITBOX.planeRadius) * (2 * HITBOX.planeRadius);
      for (let i = 0; i < planes.length; i++) {
        const a = planes[i]!;
        if (a.state === 'crashed' || a.state === 'eliminated') continue;
        if (a.y + HITBOX.planeRadius >= WORLD.groundY) continue;
        for (let j = i + 1; j < planes.length; j++) {
          const b = planes[j]!;
          if (b.state === 'crashed' || b.state === 'eliminated') continue;
          if (b.y + HITBOX.planeRadius >= WORLD.groundY) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (dx * dx + dy * dy < minRamDistSq) {
            crashPlane(a, `ram vs P${j + 1}`);
            crashPlane(b, `ram vs P${i + 1}`);
          }
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
        if (target.state === 'crashed' || target.state === 'eliminated') continue;
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
        aliveCount === 0
          ? { kind: 'draw' }
          : { kind: 'winner', index: aliveIndex };
      console.log(
        `[match] ${matchOutcome.kind === 'draw' ? 'DRAW' : `P${matchOutcome.index + 1} WINS`}`,
      );
    }
  }

  function drawButton(
    btn: ButtonRect,
    label: string,
    labelPx: number,
    enabled = true,
  ): void {
    ctx.fillStyle = enabled ? '#a89268' : 'rgba(70, 70, 70, 0.5)';
    ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    ctx.strokeStyle = enabled ? '#2a2014' : '#555';
    ctx.lineWidth = STROKE.emphasis;
    ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
    ctx.fillStyle = enabled ? '#2a2014' : '#888';
    ctx.font = `bold ${labelPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2);
  }

  /**
   * Selector button — smaller/subtler than the primary START button,
   * with three visual states: selected (full tan fill), enabled + not
   * selected (faded tan), disabled (grey). T7.2 uses it for the humans /
   * AI / difficulty selector rows.
   */
  function drawSelectorButton(
    btn: ButtonRect,
    label: string,
    labelPx: number,
    selected: boolean,
    enabled: boolean,
  ): void {
    ctx.fillStyle = !enabled
      ? 'rgba(60, 60, 60, 0.35)'
      : selected
        ? '#a89268'
        : 'rgba(168, 146, 104, 0.22)';
    ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    ctx.strokeStyle = enabled ? '#2a2014' : '#444';
    ctx.lineWidth = STROKE.object;
    ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
    ctx.fillStyle = !enabled ? '#777' : selected ? '#2a2014' : '#f0e4c8';
    ctx.font = `${labelPx}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2);
  }

  function renderSetup(): void {
    // Flat sky-ish background so the setup screen reads as "pre-match
    // staging" rather than an overlay on a paused game.
    ctx.fillStyle = '#4b7fae';
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 120px system-ui, sans-serif';
    ctx.fillText('CARNAGE v4.0', WORLD.width / 2, 180);
    ctx.font = '48px system-ui, sans-serif';
    ctx.fillText('Match Setup', WORLD.width / 2, 260);

    // Panel frame helper.
    function drawPanel(x: number, y: number, w: number, h: number, title: string): void {
      ctx.fillStyle = 'rgba(20, 32, 48, 0.35)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#2e4a66';
      ctx.lineWidth = STROKE.object;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(title, x + 24, y + 48);
    }

    // Controls panel (§13.1 selectors).
    drawPanel(320, 340, 560, 380, 'Controls');

    ctx.fillStyle = '#d6e4f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText('HUMANS', 600, 388);
    ctx.fillText('AI OPPONENTS', 600, 488);
    ctx.fillText('DIFFICULTY', 600, 588);

    drawSelectorButton(humansBtnRect(1), '1', 30, setupHumans === 1, true);
    drawSelectorButton(humansBtnRect(2), '2', 30, setupHumans === 2, true);
    for (let v = 0; v <= 7; v++) {
      drawSelectorButton(aiBtnRect(v), String(v), 26, setupAi === v, !aiCountDisabled(v));
    }
    drawSelectorButton(difficultyBtnRect('easy'), 'Easy', 26, setupDifficulty === 'easy', !difficultyDisabled('easy'));
    drawSelectorButton(difficultyBtnRect('medium'), 'Medium', 26, setupDifficulty === 'medium', !difficultyDisabled('medium'));
    drawSelectorButton(difficultyBtnRect('hard'), 'Hard', 26, setupDifficulty === 'hard', !difficultyDisabled('hard'));

    // Match Info panel — §13.2. Live plane count + collision mode label
    // + short explanation (T7.3), plus per-player control reminder (T7.4).
    // Rendered every frame so selector edits reflect immediately. Layout
    // is top-down single-column, packed to leave room for both sections.
    drawPanel(1040, 340, 560, 380, 'Match Info');
    const infoX = 1040 + 24;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#d6e4f2';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('TOTAL PLANES', infoX, 430);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.fillText(String(setupTotalPlanes()), infoX, 484);

    const mode = collisionModeFor(setupTotalPlanes());
    ctx.fillStyle = '#d6e4f2';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('COLLISION MODE', infoX, 522);
    // Mode rule name in the tan emphasis colour so it reads as "the active
    // rule". Explanation in the panel text colour below.
    ctx.fillStyle = '#ffd27a';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(`${mode.name} — ${mode.rule}`, infoX, 556);
    ctx.fillStyle = '#d6e4f2';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(mode.explanation, infoX, 584);

    // Per-player control reminder — §13.2, T7.4. Label each row with the
    // plane's signature colour (matches the in-match HUD pips) so the map
    // ties cleanly to who-is-who. P2 shows keys when human, pilot label
    // when AI; mobile touch reminders land at T10.5.
    ctx.fillStyle = '#d6e4f2';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('CONTROLS', infoX, 622);

    const rowAnnotation = '(rotate · action · rotate)';
    const keyColX = infoX + 56;
    const noteColX = infoX + 172;

    function drawControlRow(
      label: string,
      labelColor: string,
      keys: string,
      note: string | null,
      y: number,
    ): void {
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillStyle = labelColor;
      ctx.fillText(label, infoX, y);
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(keys, keyColX, y);
      if (note !== null) {
        ctx.font = '18px system-ui, sans-serif';
        ctx.fillStyle = '#a0b4c8';
        ctx.fillText(note, noteColX, y);
      }
    }

    // Setup preview uses PLAYER_COLORS directly rather than planes[].color
    // so it renders correctly before / between matches when the planes
    // array may not reflect the pending selections yet.
    drawControlRow('P1', PLAYER_COLORS[0] ?? '#fff', 'A  S  D', rowAnnotation, 656);
    if (setupHumans === 2) {
      drawControlRow('P2', PLAYER_COLORS[1] ?? '#fff', 'J  K  L', rowAnnotation, 690);
    } else {
      drawControlRow('P2', PLAYER_COLORS[1] ?? '#fff', `AI (${setupDifficulty})`, null, 690);
    }

    // START button — disabled when combination is out of §13.1 range.
    const startEnabled = setupIsValid();
    drawButton(SETUP_START_BUTTON, 'START', 56, startEnabled);

    ctx.fillStyle = startEnabled ? '#d6e4f2' : '#d67a7a';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
      startEnabled
        ? 'click START or press Enter / Space'
        : `total planes ${setupTotalPlanes()} — valid range ${MIN_TOTAL_PLANES}–${MAX_TOTAL_PLANES_CURRENT}`,
      WORLD.width / 2,
      SETUP_START_BUTTON.y + SETUP_START_BUTTON.h + 56,
    );
  }

  function renderRotateOverlay(): void {
    // Drawn in raw canvas coordinates so sizing is consistent regardless
    // of the (nonsensical) portrait letterbox transform that would apply
    // via the viewport. Fills the whole canvas in dark.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14192a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const base = Math.min(canvas.width, canvas.height) * 0.06;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${base * 1.4}px system-ui, sans-serif`;
    ctx.fillText('ROTATE YOUR DEVICE', cx, cy - base * 0.9);
    ctx.font = `${base * 0.7}px system-ui, sans-serif`;
    ctx.fillStyle = '#d6e4f2';
    ctx.fillText('Carnage plays in landscape orientation.', cx, cy + base * 0.6);
    ctx.restore();
  }

  /**
   * Auto-start warning pulse (§11, T11.2). At each entry of the timer past
   * a `MATCH.autoStartWarningsSec` threshold (T−2 s and T−1 s by default),
   * emit a single short expanding-ring pulse around the plane. Subtle by
   * design — §11 calls this a cue, not a rescue alarm — so the ring fades
   * fully within ~0.5 s and only appears at the two trigger moments.
   *
   * Driven entirely off `autoStartTimerSec`; no separate event state is
   * needed. The pulse window for trigger T is the half-open interval
   * (timer ≤ T) ∧ (T − timer ≤ PULSE_DUR), which catches every tick the
   * pulse should be visible regardless of dt jitter.
   */
  const AUTO_START_PULSE_DUR_SEC = 0.5;
  function drawAutoStartWarning(p: Plane): void {
    if (p.state !== 'grounded' || p.taxiCommitted) return;
    for (const triggerAt of MATCH.autoStartWarningsSec) {
      const sinceTrigger = triggerAt - p.autoStartTimerSec;
      if (sinceTrigger < 0 || sinceTrigger > AUTO_START_PULSE_DUR_SEC) continue;
      const t = sinceTrigger / AUTO_START_PULSE_DUR_SEC;
      const r = HITBOX.planeRadius * (1.6 + 1.6 * t);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Draw a single virtual button — translucent tan disc with a symbol,
   * brighter highlight while the player's finger is down. Kept simple so
   * the buttons don't obscure the playfield more than necessary (§14.2).
   */
  function drawVirtualButton(btn: VirtualButton): void {
    const pressed = pressedVirtualButtons.has(btn.control);
    const color = btn.player === 1 ? PLAYER_COLORS[0]! : PLAYER_COLORS[1]!;
    ctx.save();
    ctx.globalAlpha = pressed ? 0.9 : 0.45;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(btn.x, btn.y, btn.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#2a2014';
    ctx.lineWidth = STROKE.object;
    ctx.stroke();
    ctx.fillStyle = '#2a2014';
    ctx.font = `bold ${btn.radius * 0.9}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph =
      btn.control === 'p1-ccw' || btn.control === 'p2-ccw' ? '◀'
      : btn.control === 'p1-cw' || btn.control === 'p2-cw' ? '▶'
      : '●';
    ctx.fillText(glyph, btn.x, btn.y + btn.radius * 0.05);
    ctx.restore();
  }

  function render(): void {
    frameCount++;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Portrait overlay — §6. Drawn in canvas-pixel coords (bypasses the
    // logical playfield transform so text is sized against the actual
    // window regardless of the letterboxing from the 16:9 assumption).
    if (isPortraitOrientation()) {
      renderRotateOverlay();
      return;
    }

    ctx.save();
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.scale, viewport.scale);

    if (gameState === 'setup') {
      renderSetup();
      ctx.restore();
      return;
    }

    drawArena(ctx);

    // Dogfight-mode ghost-through effect — §9.4, §9.5, T8.5. Compute per-
    // plane whether *this* plane is currently overlapping any other
    // airborne plane; if so, draw it semi-transparent so the pass-through
    // reads as intentional rather than a clipping glitch. Close Quarters
    // mode kills on overlap (handled in update) so this never fires there.
    const ghostingPlane: boolean[] = new Array(planes.length).fill(false);
    if (matchMode === 'dogfight') {
      const ghostDistSq = (2 * HITBOX.planeRadius) * (2 * HITBOX.planeRadius);
      for (let i = 0; i < planes.length; i++) {
        const a = planes[i]!;
        if (a.state === 'crashed' || a.state === 'eliminated') continue;
        if (a.y + HITBOX.planeRadius >= WORLD.groundY) continue;
        for (let j = i + 1; j < planes.length; j++) {
          const b = planes[j]!;
          if (b.state === 'crashed' || b.state === 'eliminated') continue;
          if (b.y + HITBOX.planeRadius >= WORLD.groundY) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (dx * dx + dy * dy < ghostDistSq) {
            ghostingPlane[i] = true;
            ghostingPlane[j] = true;
          }
        }
      }
    }

    for (let i = 0; i < planes.length; i++) {
      const p = planes[i]!;
      // Eliminated planes are out of the match (§12) — the wreck's 1.5 s
      // explosion delay has already elapsed, so don't render anything.
      if (p.state === 'eliminated') continue;
      // Auto-start warning pulses (T11.2, §11). Subtle expanding ring
      // emitted at T−2 s and T−1 s before auto-start fires — drawn under
      // the plane sprite so it reads as a halo around the airframe.
      drawAutoStartWarning(p);
      const ghosting = ghostingPlane[i];
      if (ghosting) ctx.globalAlpha = 0.45;
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
      if (ghosting) ctx.globalAlpha = 1.0;
    }

    // Crash explosions (T11.1) — drawn above planes so flecks visibly
    // emerge from the wreck rather than getting hidden behind it. Below
    // bullets so an in-flight round still reads against any active burst.
    drawExplosions(ctx, explosions);

    // Bullets render above planes so a round passing in front of a plane
    // reads correctly. Bullets don't wrap (§10) so no ghost pass.
    for (const b of bullets) drawBullet(ctx, b);

    // Match-start mode banner — §9.4, T8.4. Brief flash at match start so
    // the active collision rule is unambiguous. Fades out over the last
    // ~0.6 s of its lifetime. Rendered in the plane-colour emphasis hue
    // used by the persistent HUD indicator for continuity.
    if (matchStartBannerRemainingSec > 0) {
      const fadeStart = 0.6;
      const alpha =
        matchStartBannerRemainingSec >= fadeStart
          ? 1
          : matchStartBannerRemainingSec / fadeStart;
      const bannerText = matchMode === 'dogfight' ? 'BULLETS ONLY' : 'RAMMING ON';
      const bannerColor = matchMode === 'dogfight' ? '#7ac6ff' : '#ffb06b';
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = bannerColor;
      ctx.font = 'bold 108px system-ui, sans-serif';
      ctx.fillText(bannerText, WORLD.width / 2, WORLD.height * 0.22);
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        matchMode === 'dogfight'
          ? 'planes pass through · only bullets kill'
          : 'mid-air collisions destroy both planes',
        WORLD.width / 2,
        WORLD.height * 0.22 + 72,
      );
      ctx.restore();
    }

    ctx.fillStyle = '#fff';
    ctx.font = '28px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Carnage v4.0 — Phase 11 · ${planes.length}-plane · ${matchMode === 'dogfight' ? 'Dogfight' : 'Close Quarters'}`, 32, 48);

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
    // Top-right debug stat columns: P1 right-aligned, P2 left-aligned. Only
    // the first two planes for now — full 8-plane debug would clutter the
    // sky. Core gameplay info (lives) reads from the bottom HUD strip below.
    if (planes[0]) {
      drawPlaneStats(
        `P1 (${pilots[0]?.label ?? '—'})`,
        planes[0],
        32,
        'left',
      );
    }
    if (planes[1]) {
      drawPlaneStats(
        `P2 (${pilots[1]?.label ?? '—'})`,
        planes[1],
        WORLD.width - 32,
        'right',
      );
    }

    // Per-player lives — §7, §12, §16.3. Bottom HUD strip. One compact
    // slot per plane with a fixed max slot width so layout stays tight
    // regardless of plane count — N=2 matches cluster near the centre
    // instead of spreading to the playfield edges. Centre gap reserved
    // for the mode indicator (T8.4). Slot layout: left half takes the
    // first ceil(N/2) planes, right half the rest, both packed toward
    // the central mode gap so the whole HUD block stays visually unified.
    const hudCentreY = WORLD.groundY + WORLD.hudHeight / 2;
    const modeGap = 200;
    const n = planes.length;
    if (n > 0) {
      const maxSlotWidth = 220;
      const maxAvailablePerSide = (WORLD.width - modeGap - 48) / 2;
      const leftHalfCount = Math.ceil(n / 2);
      const rightHalfCount = n - leftHalfCount;
      const maxHalfCount = Math.max(leftHalfCount, rightHalfCount, 1);
      const slotWidth = Math.min(maxSlotWidth, maxAvailablePerSide / maxHalfCount);
      const labelWidth = n <= 4 ? 52 : 40;
      const pipGapExtra = n <= 4 ? 4 : 2;

      // Left half: slots packed toward the centre gap (innermost-left
      // slot sits just outside the mode indicator). Right half: mirror.
      const centreX = WORLD.width / 2;
      const leftRightEdge = centreX - modeGap / 2;
      const rightLeftEdge = centreX + modeGap / 2;
      const leftStartX = leftRightEdge - leftHalfCount * slotWidth;
      for (let i = 0; i < n; i++) {
        const p = planes[i]!;
        const onLeft = i < leftHalfCount;
        const slotX = onLeft
          ? leftStartX + i * slotWidth
          : rightLeftEdge + (i - leftHalfCount) * slotWidth;

        ctx.save();
        ctx.font = `bold ${n <= 4 ? 30 : 24}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = p.color;
        ctx.fillText(`P${i + 1}`, slotX + 6, hudCentreY);

        const pipAreaW = slotWidth - labelWidth - 12;
        const pipStep = pipAreaW / MATCH.startingLives;
        const pipRadius = Math.min(9, Math.max(4, pipStep / 2 - pipGapExtra / 2));
        const pipStartX = slotX + labelWidth + 6;
        for (let life = 0; life < MATCH.startingLives; life++) {
          const cx = pipStartX + life * pipStep + pipStep / 2;
          ctx.beginPath();
          ctx.arc(cx, hudCentreY, pipRadius, 0, Math.PI * 2);
          if (life < p.lives) {
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
    }

    // Centre mode indicator (§9.4, T8.4) — persistent HUD label so the
    // active collision rule is unambiguous throughout the match.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle = matchMode === 'dogfight' ? '#7ac6ff' : '#ffb06b';
    const modeLabel = matchMode === 'dogfight' ? 'BULLETS ONLY' : 'RAMMING ON';
    ctx.fillText(modeLabel, WORLD.width / 2, hudCentreY);
    ctx.restore();

    // Skip-to-result button (§12, T11.4) — only while every human is out
    // and AI fight on. Rendered above the bottom-half so it stays clear
    // of the playfield action and out from under the result overlay.
    if (!matchOver && humansAllEliminated()) {
      drawButton(SKIP_TO_RESULT_BUTTON, 'SKIP TO RESULT', 36);
      ctx.fillStyle = '#e8e8e8';
      ctx.font = '20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(
        'AI fight to the finish — skip to declare the lives leader',
        WORLD.width / 2,
        SKIP_TO_RESULT_BUTTON.y + SKIP_TO_RESULT_BUTTON.h + 28,
      );
    }

    // Virtual touch controls — §14.2, T10.3 / T10.4. Rendered only on
    // touch devices so desktop play is undisturbed. Translucent fill
    // keeps the playfield visible behind the button discs; pressed
    // buttons opaque so the player sees their finger "registered".
    if (isTouchDevice) {
      for (const btn of VIRTUAL_BUTTONS) drawVirtualButton(btn);
    }

    // Result overlay — §12, T5.5. Drawn last so it sits above planes,
    // bullets and HUD. Dim the sky (not the HUD strip — lives + bottom bar
    // stay legible so the player can see the final score), name the winner
    // in their signature colour, and show a Play Again button as the visual
    // affordance. Click anywhere on canvas OR Enter / Space restarts.
    if (matchOver && matchOutcome) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, WORLD.width, WORLD.groundY);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const winMsg =
        matchOutcome.kind === 'draw'
          ? 'DRAW'
          : `P${matchOutcome.index + 1} WINS`;
      const winColor =
        matchOutcome.kind === 'winner'
          ? planes[matchOutcome.index]?.color ?? '#ffffff'
          : '#ffffff';
      ctx.fillStyle = winColor;
      ctx.font = 'bold 120px system-ui, sans-serif';
      ctx.fillText(winMsg, WORLD.width / 2, WORLD.height * 0.32);

      drawButton(RESULT_PLAY_AGAIN_BUTTON, 'PLAY AGAIN', 56);

      ctx.fillStyle = '#e8e8e8';
      ctx.font = '28px system-ui, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(
        'click PLAY AGAIN or press Enter / Space',
        WORLD.width / 2,
        RESULT_PLAY_AGAIN_BUTTON.y + RESULT_PLAY_AGAIN_BUTTON.h + 56,
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
