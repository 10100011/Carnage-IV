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
  main.ts          # entry point (grows as tasks land)
index.html         # app shell
vite.config.ts     # build config (static-friendly relative paths)
tsconfig.json      # strict TypeScript settings
PROMPT.md          # design spec
TASKS.md           # implementation worklist
```

## Controls

*Will be filled in as phases land — see `PROMPT.md` §14.*

## Manual test plan

*Will be filled in at Phase 11 per `PROMPT.md` §19 acceptance criteria.*
# Carnage-IV
