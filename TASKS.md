# Carnage v4.0 — Implementation Task List

> **For the implementing agent:** this is the worklist for building the game specified in `PROMPT.md`. Tasks are sized so each should fit in a single focused LLM session (≈ 100–500 lines of code, 1–3 files touched, independently testable).
>
> **Working rules:**
> - Do tasks in numeric order within a phase, and complete a phase before starting the next.
> - After every task, the game must still start without errors, and the relevant new behaviour must be checkable in the browser.
> - When a task says "see §X" it refers to that section of `PROMPT.md`.
> - `config.js` (or equivalent) is the single source of truth for tunable constants (§18). Never inline magic numbers — add them to config.
> - Keep each task's diff tight: **no speculative features, no surrounding refactors, no premature abstractions**. A later task will usually handle what you're tempted to add now.
> - Flag (don't fix) anything you hit that contradicts `PROMPT.md`.

---

## Phase 0 — Project scaffold

**Goal:** a runnable empty browser page with the build pipeline in place.

- **T0.1 — Scaffold the project.** Decide framework (vanilla Canvas 2D + TypeScript recommended, or Kaplay / Phaser 3). Create `index.html`, entry TS/JS file, `package.json`, a dev server, and a static-build command that outputs a single shippable folder. Document both in the README. *Done when:* `npm run dev` serves a blank canvas page; `npm run build` produces a static folder that runs when opened directly.
- **T0.2 — Create `config.ts` (or `.js`).** Add every tunable constant listed in §18 as a named export with a *guessed* initial value and a comment referencing its §-source. No logic yet. *Done when:* the module imports cleanly and re-opening the prompt maps every §18 entry to a constant.
- **T0.3 — Fixed-timestep game loop.** Standard `requestAnimationFrame` loop with a fixed-step accumulator (e.g. 60 updates/sec) separate from render. Expose `update(dt)` and `render()` hooks. *Done when:* the loop runs, a frame counter in the corner increments visibly, and an intentional spin-for-1s doesn't desync the timestep.

---

## Phase 1 — Arena skeleton

**Goal:** static arena drawn in a 16:9 letterboxed viewport.

- **T1.1 — 16:9 logical viewport with letterbox scaling (§6).** Logical coords are fixed (e.g. 1920×1080); canvas scales to fit the window, letterboxing the difference. *Done when:* resizing the browser keeps the playfield centred, correctly letterboxed, and aspect-locked.
- **T1.2 — Draw static arena placeholders (§7).** Sky colour, HUD strip (bottom 10%), runway strip above HUD, central tower rectangle (placeholder dims from config). *Done when:* the arena reads at a glance and all four regions are visible.

---

## Phase 2 — Single-plane air physics

**Goal:** one test plane that flies, stalls, recovers, and wraps — no takeoff, no combat yet.

- **T2.1 — Plane entity + placeholder sprite (§6, §9.7).** Data: position, velocity, heading, state enum (grounded/airborne/stalled). Render a triangle or rectangle aligned to heading. Spawn it mid-air for now so we can test physics. *Done when:* a plane shape renders and can be positioned by editing code.
- **T2.2 — 360° continuous rotation (§8.1).** Temporary test keys (e.g. `[` / `]`) rotate heading. Rotation rate from config. *Done when:* the test plane rotates smoothly, wrap around 360° is clean.
- **T2.3 — Constant thrust + pitch-speed coupling (§8.2, §8.3).** Airborne thrust is constant; acceleration along the flight vector is `thrust − gravityComponent(pitch)`. Best climb at ~30° off horizontal. *Done when:* climbing steeply slows the plane; diving speeds it up; level flight holds speed.
- **T2.4 — Gravity (no stall yet).** Gravity acts always, included in the pitch-speed calc. *Done when:* a plane pointed level gradually noses down if not actively rotated (depending on coupling tune; at minimum gravity is present in motion).
- **T2.5 — Horizontal screen wrap (§8.5).** Crossing the left/right edge teleports to the other edge, same altitude/velocity/heading. Render at both edges during the crossing frame. *Done when:* the plane exits one edge and appears at the other seamlessly.
- **T2.6 — Stall: airspeed trigger + fall behaviour (§8.4).** Below `STALL_THRESHOLD` → state = stalled; thrust disabled, gravity dominates, horizontal velocity preserved, player keeps rotation. *Done when:* slowing below threshold causes the plane to fall with drifting horizontal motion; rotation still responds.
- **T2.7 — Stall: top-of-screen trigger (§8.4).** Reaching the ceiling line also stalls. *Done when:* climbing into the top 5% triggers a stall.
- **T2.8 — Stall recovery (§8.4).** Exit stall when pitch ≈ straight down (within tolerance) AND airspeed > threshold. *Done when:* pointing the stalled plane down and accelerating restores normal flight.
- **T2.9 — Ground-crash detection in flight (§9.8).** Airborne plane whose hitbox touches the ground → crash event (no respawn yet; log to console). *Done when:* crashing into the ground fires the crash event once; subsequent frames don't re-fire it.

---

## Phase 3 — Takeoff & crash loop

**Goal:** a plane that takes off from the runway, crashes into the tower/ground, respawns, and can be auto-started.

- **T3.1 — Grounded state on the runway (§9.2, §11).** Plane sits on its runway slot, stationary, facing the tower. No player control while grounded except action button (next task). *Done when:* plane spawns in runway slot and renders correctly.
- **T3.2 — Action button state machine (§8.2.1).** Single input; on ground first press commits full-power taxi; while airborne presses fire (stub — no bullet yet, just a log). Resets on respawn. *Done when:* pressing on the ground starts the taxi; pressing again does nothing while grounded; pressing once airborne logs "fire".
- **T3.3 — Taxi acceleration + lift-off (§8.2, §11).** Taxi accelerates the plane along the runway at full power until airspeed passes the lift-off threshold and the plane leaves the surface (state → airborne). *Done when:* committing taxi consistently produces takeoff in ~2 seconds (§2.1 tuning).
- **T3.4 — Tower collision (§9.6).** Overlap with the tower AABB crashes the plane (air or ground). *Done when:* flying or taxiing into the tower triggers a crash event.
- **T3.5 — Crash → explosion delay → respawn (§12).** On crash: ~1.5 s pause, then plane respawns in its runway slot, grounded, facing the tower. *Done when:* any crash triggers the full loop and leaves the plane ready for another takeoff.
- **T3.6 — Anti-camping 5 s auto-start (§11).** Timer counts down from spawn; if action button not pressed, auto-start fires at T=0 and forces the taxi. *Done when:* a plane left idle auto-starts at 5 s and typically crashes into the tower.

---

## Phase 4 — Bullets

**Goal:** a plane that can shoot, with all bullet rules correct.

- **T4.1 — Bullet entity + firing on action press (§10).** Airborne press spawns a bullet at the nose, heading-aligned, constant speed, no velocity inheritance. *Done when:* pressing action in the air produces a visible bullet flying straight.
- **T4.2 — 2-bullet cap per plane (§10).** Plane cannot fire while at cap. *Done when:* rapid presses produce at most 2 live bullets per plane.
- **T4.3 — Bullets expire at screen edge (§10).** Bullets do not wrap; they disappear at left/right edges (and top/bottom as applicable). *Done when:* no bullet ever reappears on the opposite side.
- **T4.4 — Bullet ↔ plane collision, swept segment vs circle (§9.7).** Test bullet previous-pos → current-pos segment against each plane's circular hitbox. Hit = bullet expires + target crash event. *Done when:* at maximum bullet speed no plane is tunnelled through.
- **T4.5 — Bullet ↔ tower collision (§9.6).** Bullets blocked/expire on tower AABB hit. *Done when:* shooting at the tower stops bullets cleanly.
- **T4.6 — Grounded plane bullet immunity (§10).** While plane hitbox touches the runway surface, bullets pass through it harmlessly. Immunity ends the instant the hitbox leaves the runway. *Done when:* firing at a plane on the runway does not kill it; the same shot seconds after lift-off does.

---

## Phase 5 — Two local humans

**Goal:** full 2-player match loop on one keyboard.

- **T5.1 — Two planes, mirrored right-runway render (§9.2).** Plane 1 on left runway facing right; Plane 2 on right runway facing left (sprite mirrored). *Done when:* both planes spawn in the correct slots and face inward.
- **T5.2 — P1/P2 keyboard mapping (§14.1).** P1 = `A` / `S` / `D`; P2 = `J` / `K` / `L`. Independent input state. *Done when:* both players can play simultaneously with no key conflicts.
- **T5.3 — Plane ↔ plane mid-air collision (§9.3 Close Quarters mode).** Overlap in the air = both crash. Ground overlap is ignored per §9.5. *Done when:* two planes ramming in flight both crash; sitting on the runway together does nothing.
- **T5.4 — Lives system + HUD display (§12).** Each player starts with 8 lives; crash decrements; HUD shows per-player lives bottom strip. *Done when:* HUD accurately tracks lives over a match.
- **T5.5 — Match end + result screen + play again (§12).** When only one player remains alive (or simultaneous collision → draw), freeze the match, show a result screen naming the winner, with a Play Again button that restarts. *Done when:* an 8-life match resolves to a winner and replays cleanly.

---

## Phase 6 — Medium AI bot

**Goal:** one functioning medium-tier AI opponent.

- **T6.1 — AI pilot stub + assignment to a plane (§15).** A pilot interface (`update(plane, world) → inputs`); AI implementation plugged into Plane 2 instead of P2 keyboard. *Done when:* switching P2 from human to AI works via a dev flag.
- **T6.2 — AI state machine: takeoff → climb → pursue → fire (§15.1).** Take off on spawn, climb to a target altitude band, rotate toward nearest opponent, fire when aim is within tolerance and bullets are available. *Done when:* medium AI takes off, reaches altitude, and shoots roughly toward the human.
- **T6.3 — AI obstacle avoidance: ground and tower (§15.1).** AI should not fly into the ground or tower under normal play. *Done when:* a 5-minute AI-only observation shows ≤ 1 self-crash from avoidable causes.

---

## Phase 7 — Setup & lobby screen

**Goal:** a proper pre-match configuration screen.

- **T7.1 — Setup screen scaffold (§13).** A pre-match screen replacing the current hard-coded start. Layout reserves space for controls (next tasks). *Done when:* the game boots into the setup screen and the Start button launches the current default match.
- **T7.2 — Human / AI count + difficulty selectors (§13.1).** Humans: 1 or 2; AI: 0–7; total 2–8; difficulty easy/medium/hard (only medium wired — others may be greyed per §5 interim-build note). *Done when:* all valid combinations start correctly; invalid ones are prevented.
- **T7.3 — Live plane count + collision mode label + explanation (§13.2).** Display total and, at ≥ 5, "Dogfight — Bullets Only"; at ≤ 4, "Close Quarters — Ramming ON". Include a short human-readable explanation. *Done when:* changing counts updates the label live.
- **T7.4 — Control reminder per player (§13.2).** Per-player key map shown on the setup screen. *Done when:* both players can see their controls before Start.
- **T7.5 — Session-only settings persistence (§13.3).** After a match, returning to setup pre-fills last choices. No cross-session storage. *Done when:* Play Again → Setup shows previous values.

---

## Phase 8 — Scaling to 3–8 planes

**Goal:** full 1–8 plane support with collision-mode switching and signalling.

- **T8.1 — N-plane spawn placement (§9.2).** Alternating left/right assignment; spacing `i / (n+1)` along each side's usable length; inner-most nearest tower. *Done when:* 3-, 5-, and 8-plane matches spawn correctly.
- **T8.2 — HUD scales to 3–8 players (§7, §12).** HUD accommodates up to 8 per-player life indicators without overlap. *Done when:* an 8-player match shows all lives legibly.
- **T8.3 — Collision mode switch at ≥ 5 planes (§9.3).** Match total of ≤ 4 = Close Quarters (ramming on); ≥ 5 = Dogfight (pass-through). Mode fixed at match start. *Done when:* behaviour matches total count.
- **T8.4 — Mode signalling: match-start banner + persistent HUD icon (§9.4).** Brief banner on round start ("RAMMING ON" / "BULLETS ONLY"); small persistent HUD indicator throughout. *Done when:* mode is unambiguous from screen alone.
- **T8.5 — Ghost-through visual in Dogfight mode (§9.4).** Short transparent overlap effect so pass-through reads as intentional. *Done when:* planes passing through each other are visibly "ghosting", not glitching.

---

## Phase 9 — AI difficulty tiers

**Goal:** easy and hard AI added beside medium.

- **T9.1 — Easy AI tier (§15.2).** Slow rotation, wide firing-arc tolerance, no prediction, occasional panic stalls. *Done when:* a competent human beats easy AI consistently.
- **T9.2 — Hard AI tier (§15.2).** Predictive aim (accounts for bullet travel time + opponent trajectory), aggressive altitude management, occasional tower-cover use. *Done when:* hard AI is clearly harder than medium on the same opponent.

---

## Phase 10 — Mobile

**Goal:** 2-human phone session in landscape with multi-touch.

- **T10.1 — Landscape lock + portrait rotate overlay (§6, §14.2).** Detect orientation; in portrait, cover the screen with a "please rotate" overlay. *Done when:* portrait shows the overlay; landscape hides it.
- **T10.2 — Independent multi-touch handler (§14.2).** Touch manager that tracks ≥ 4 simultaneous touches independently; each touch bound to a control based on its start location. *Done when:* four fingers on the screen register four independent touches.
- **T10.3 — Per-player virtual rotate control (§14.2).** Left/right virtual buttons (or a horizontal rotation slider) on each half of the screen, per player. *Done when:* each player can rotate their plane independently.
- **T10.4 — Per-player virtual action button (§14.2).** Action button on each half-screen. *Done when:* both players can commit taxi and fire from their touch controls simultaneously.
- **T10.5 — Touch-friendly setup screen (§13).** Setup-screen selectors usable by touch. *Done when:* a 2-player mobile match can be configured without a keyboard.

---

## Phase 11 — Polish

**Goal:** feel, readability, art. No new mechanics.

- **T11.1 — Explosion animation on crash (§5 Build Phases).** Short particle/sprite burst during the 1.5 s respawn delay. *Done when:* every crash shows an explosion effect.
- **T11.2 — Auto-start warning pulse at T−2 s and T−1 s (§11).** Subtle flashing/glowing marker near the plane. *Done when:* idle planes get two visible warning pulses before auto-start.
- **T11.3 — Stall visual effect (§8.4, §16.3).** Wobble / smoke / limp control lines during stall state. *Done when:* stall state is instantly recognisable.
- **T11.4 — Skip-to-result button during AI-only continuation (§12).** Button appears when all humans are out; tap/click ends the match declaring the leading AI the winner (explicitly an approximation). *Done when:* the button appears only in the right conditions and resolves correctly.
- **T11.5 — Per-player plane colours + HUD colour match (§16.3).** Each slot gets a signature colour carried through plane sprite and HUD element. *Done when:* colour identifies player at a glance.
- **T11.6 — README with manual test plan (§4, §19).** Document how to run/build, controls, difficulty selection, and a short manual test plan covering each acceptance behaviour in §19. *Done when:* a stranger can clone, run, and verify the game in 10 minutes.
- **T11.7 — Art pass per §16 north star.** Placeholder shapes replaced with final art aligned to the Luftrausers × R-Type × cutesy direction. Only run once art-direction sub-items in §16.2 are locked. *Done when:* match passes the visual coherence bar.

---

## Notes on ordering and concurrency

- **Strict prerequisites:** each phase depends on all previous phases completing.
- **Within a phase,** most tasks are linear; the few that can parallelise are still best done serially for a single implementing agent to avoid integration drift.
- **Tuning passes** (feel-check per §2.1) should happen at end of Phase 5, Phase 8, and Phase 11. Do not defer all tuning to the end.
- **Flag-only, do-not-fix** policy: if during any task you notice an apparent contradiction between `PROMPT.md` and implementation reality, stop and raise it rather than improvising a fix.

*End of TASKS.md v1.*
