# Carnage v4.0

A browser-based 2D biplane dogfight game. See [`PROMPT.md`](./PROMPT.md) for the full design spec and [`TASKS.md`](./TASKS.md) for the implementation worklist.

## Requirements

- Node.js ≥ 18
- A modern browser (Chrome, Safari, Firefox, or Edge)

## Running locally

```
npm install
npm run dev
```

Vite serves the dev build at <http://localhost:5173>. Hot module reload is enabled.

> **Note — don't double-click the root `index.html`.** It is a dev shell that references `src/main.ts` (TypeScript source), and only works when served by Vite. For a standalone build you can open directly, see *Building for static hosting* below.

## Building for static hosting

```
npm run build
```

Output lands in `dist/`. That folder is fully self-contained and can be:

- served from any static host (GitHub Pages, Netlify, itch.io, `python -m http.server` inside `dist/`), or
- opened directly by double-clicking `dist/index.html` (Vite is configured with `base: './'` so all asset paths are relative).

`npm run preview` serves the built output locally for a final check.

## Framework choice

**Vanilla Canvas 2D + TypeScript, built with Vite.**

- Game complexity (≤ 8 planes, bullets, bespoke physics, static camera) is well within vanilla Canvas 2D's comfort zone.
- The physics model is custom (pitch–speed coupling, directional stall recovery, 2-bullet cap). A general-purpose engine (Phaser 3, Matter.js) would mostly get in the way.
- TypeScript makes the state machines (plane grounded/airborne/stalled, action-button behaviour per `PROMPT.md` §8.2.1, AI pilot states) safer to evolve.
- Vite gives a near-zero-config TypeScript + ES-modules + dev-server + static-build pipeline. Production output is plain HTML/CSS/JS, matching `PROMPT.md` §6 tech constraints.

No runtime dependencies. Dev-time: `vite`, `typescript`.

## Project layout

```
src/
  main.ts          # entry point — game loop, input, match lifecycle, render
  arena.ts         # static arena (sky / runway / tower / HUD strip)
  plane.ts         # plane entity + placeholder sprite
  bullet.ts        # bullet entity + spawn / draw helpers
  pilot.ts         # human + AI pilot implementations (§15)
  explosion.ts     # crash flecks, shockwave ring, stall smoke (§5 polish)
  config.ts        # all tunable constants — single source of truth (§4, §18)
  loop.ts          # fixed-timestep game loop
index.html         # app shell
vite.config.ts     # build config (static-friendly relative paths)
tsconfig.json      # strict TypeScript settings
PROMPT.md          # design spec
TASKS.md           # implementation worklist
```

## Controls

### Desktop (`PROMPT.md` §14.1)

| Action                           | Player 1 | Player 2 |
| -------------------------------- | -------- | -------- |
| Rotate counter-clockwise         | `A`      | `J`      |
| **Action button** (accel / fire) | `S`      | `K`      |
| Rotate clockwise                 | `D`      | `L`      |

- Rotation keys rotate continuously while held.
- The **action button** commits taxi while grounded (§8.2.1) and fires a bullet when airborne, capped at 2 live bullets per plane (§10).
- `Enter` / `Space` accept the active screen (Start on the setup screen, Play Again on the result screen).

### Mobile (`PROMPT.md` §14.2)

- Landscape only. Portrait shows a "rotate your device" overlay.
- Each player has three on-screen buttons on their half of the screen: rotate-CCW · action · rotate-CW. Multitouch is independent (≥ 4 simultaneous touches supported).

## Setup screen

Every match is configured from the setup screen (`PROMPT.md` §13):

- **Humans:** 1 or 2.
- **AI opponents:** 0–7, constrained so total planes is between 2 and 8.
- **Difficulty:** easy / medium / hard. Applied uniformly to all AI in the match.
- The screen displays the live total plane count, the active collision mode (Close Quarters at 2–4 / Dogfight at 5–8), and the per-player control reminder.
- Settings persist for the session — Play Again returns to setup with the previous selections pre-filled.

URL overrides (developer back-door, bypasses the setup screen):

- `?p1=ai` — Player 1 becomes a medium AI.
- `?p1=ai-stub` — Player 1 becomes the static-input AI stub (debug only).
- `?p2=ai` (default for back-door) / `?p2=human` / `?p2=ai-stub`.

## Tuning

All gameplay constants live in [`src/config.ts`](./src/config.ts). Edit, save, and Vite hot-reloads. See `PROMPT.md` §18 for the full list. The file includes load-time invariants (e.g. bullet speed > max airspeed) so a misconfigured constant fails fast at startup.

## Manual test plan

A short sweep covering each `PROMPT.md` §19 acceptance behaviour. Each step should take under a minute; run them in order against a fresh build (`npm run dev`).

1. **Boot — no console errors.** Open the dev URL. The setup screen renders. The browser console is clean.
2. **Setup screen wiring.** Click Humans = 2, AI = 6, Difficulty = Hard. The total-planes readout updates to `8`, the collision-mode label flips to *Dogfight — Bullets Only*, and the P2 control row shows `J K L`. Click Start; an 8-plane match begins with the *BULLETS ONLY* match-start banner.
3. **Takeoff & physics core.** Reset to 1 human + 1 medium AI. Press `S` to commit P1's taxi — the plane should be airborne in roughly two seconds. Hold `D` to climb steeply: speed bleeds and you eventually stall. The stall is unmistakable — the plane wobbles, trails grey smoke, and outlines red. Rotate to point straight down (`D D D…`); when you regain airspeed, normal flight resumes.
4. **Horizontal wrap (§8.5).** Fly off the right edge — the plane reappears at the left edge with the same altitude / heading / velocity. Bullets do **not** wrap (verify by firing toward the edge while flying).
5. **Bullet cap + grounded immunity (§10).** Press `S` rapidly while airborne — at most 2 live bullets exist per plane. Crash and respawn; while grounded, the AI's bullets pass through your taxiing plane harmlessly. The instant you lift off, the next bullet kills.
6. **Tower block (§9.6).** Position over the tower and fire downward — bullets stop at the tower's top edge. Fly into the tower from the side — the plane crashes, plays the explosion burst, and respawns.
7. **Auto-start warning + commit (§11).** Spawn and don't press anything. At T−2 s and T−1 s a coloured ring pulses around your plane. At T = 0 the plane auto-taxis into the tower. (You can also test this from any respawn — leave the controls alone after dying.)
8. **Match end + result screen (§12).** Play out a 1v1 (1 human + 1 easy AI works well). Lose all 8 lives — the result screen names the winner in their signature colour. Click Play Again or press Enter — setup re-appears with your previous selections.
9. **Skip-to-result (§12, T11.4).** Configure 1 human + 2+ AI. Lose all 8 lives. While the AI continue the match, a *SKIP TO RESULT* button appears at top-centre. Click it — the match ends and the lives-leader AI is declared winner (ties → draw).
10. **Collision-mode signalling (§9.4).** Start a match with total planes ≤ 4 — banner reads *RAMMING ON* and mid-air collisions destroy both planes. Start one with ≥ 5 — banner reads *BULLETS ONLY* and overlapping planes "ghost" through each other (semi-transparent during overlap). The persistent HUD indicator confirms the mode throughout.
11. **8-plane stress (`PROMPT.md` §19).** Configure 2 humans + 6 hard AI and play for ~30 s. Frame counter (top-right) increments smoothly; the HUD strip shows all eight per-player life rows without overlap.
12. **Mobile / touch (`PROMPT.md` §14.2).** Open the dev build on a phone in landscape. The six virtual buttons (three per player) appear above the HUD. Four simultaneous touches register independently. Rotate the device to portrait — the *ROTATE YOUR DEVICE* overlay covers the screen.
13. **Tuning hot-path.** Change `PHYSICS.thrust` in `src/config.ts` to `300` and save. Vite hot-reloads; takeoffs now feel sluggish. Restore to `450`.
14. **Feel check (qualitative, §2.1 / §19).** Play a 2-human match end-to-end. It should feel chaotic-arcade — fights resolve fast, takeoffs are routine, stalls are rare and usually deliberate, most action sits well above the tower. The §2.1 anchors are tuning *indicators*, not pass/fail thresholds.
