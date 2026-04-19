# Carnage v4.0 — Browser Biplane Duel

> **Status:** Draft v4.3 (post self-critique). Ready for hand-off.
> **Lineage:** Spiritual successor to Intellivision *Triple Action* (1981, biplane mode), Amiga *BIP / Biplane Duel* (~1989), and freeware MS-DOS *Carnage* (~1996). No canonical version — we pick the most fun.
> **Change log:**
> - v2: added game-feel charter (§2), priority tiers & decision hierarchy (§3). Tightened collision geometry, spawn spacing, self-kill, visual north star. Added 4-vs-5 collision signalling.
> - v3: added tuning targets (§2.1). Promoted phone 2P to v1 requirement. Firmed grounded immunity (instant at lift-off) and self-kill (permanent). AI winners named on result screen.
> - v4: clarified thrust as **commit-on-press, no throttle-back** (§8.2 / §11) — removes the need for auto-start timer-reset semantics. Added Setup & Lobby as an explicit deliverable (§13). Added skip-to-result during AI-only continuations (§12). Tightened mobile tie-break (§3.4) and mobile acceptance (§19). Removed runway friction from tunables.
> - v4.1 (editorial): added §8.2.1 shared-input state machine. Clarified that ground-level crashes can only be into the tower. Noted that skip-to-result is an accepted approximation. Allowed interim milestone builds to grey out setup options. Fixed footer version.
> - v4.2 (editorial): unified shared-input terminology to **"action button"** everywhere (replaces "accelerate/fire key", "fire key", "shoot-key", and sibling variants). Verb forms of "fire" / "accelerate" retained where semantically correct.
> - v4.3: reframed §2.1 as **tuning anchors** (aim-at targets) rather than measurable acceptance thresholds, and rewrote the §19 feel check as a qualitative playtester gut-check. The §2.1 numbers now explicitly do not gate hand-off; feel is judged by playing, not by chasing numbers.

---

## 1. Mission

Build a browser-based 2D biplane dogfight game. Two runways at the bottom of a single static screen face a central tower; up to eight biplanes take off, climb, loop, stall, and shoot each other down. Local multiplayer only in v1. Runs as a static site.

---

## 2. Game Feel Charter

This section defines the *experience*. The rest of the prompt defines the machine; this defines what the machine should produce. If an implementation is mechanically compliant but the feel is wrong, feel wins.

- **Chaotic arcade, not sim.** Planes handle lightly. Fights resolve fast. Crashes are cheap and frequent. Fun beats realism in every decision.
- **Matches last 3–5 minutes, frantic pace.** Eight lives per player should evaporate. If matches routinely drag past seven minutes, the constants are wrong — retune.
- **Mastery is marksmanship.** The skill ceiling is tracking a moving opponent through the sky and firing accurately. Physics complications (stall, climb penalty, runway) exist to add variety, not to gate skill.
- **Stalls are a rare, optional advanced tool, not a routine failure.** A skilled player may induce a stall deliberately — for example, stalling briefly to fire rearward while drifting forward, then diving to recover. Most matches should contain few stalls. The mechanic is there to be exploited by those who find it.
- **Takeoff is a short learning curve, not a recurring hazard.** After a couple of matches, liftoff should feel routine. The tower and runway exist primarily to prevent "runway-wrap" camping (shuttling endlessly along the ground, wrapping at each edge, never taking off) — not to punish takeoff skill.
- **The tower is secondary scenery.** It blocks bullets at very low altitude and stops runway campers, but most of the drama happens well above it.
- **Aesthetic: bright, cutesy, readable.** A *Luftrausers* silhouette sensibility crossed with *R-Type* arcade clarity, but cuter and lighter. This is a bright, bloodless, fast, funny sky-fight — not a grim combat sim. We are not "crashing biplanes" in any serious sense.

### 2.1 Tuning anchors

Rough numeric targets the implementing agent and playtesters can aim at while tuning constants. **These are not acceptance thresholds.** Feel is judged by *playing* the game (§19 feel check), not by measuring it against this list. If the game feels right at 6-minute matches with two stalls a side, don't retune just to hit the numbers; if it feels wrong while nominally hitting them, the numbers are wrong.

- **Match duration:** 3–5 minutes typical. Matches consistently running past ~7 minutes is a tuning signal — retune, don't enforce a timer.
- **Routine takeoff:** spawn to airborne in ~2 seconds for a competent player.
- **Accidental stalls:** rare — roughly 0–1 per competent player per match. Deliberate stall-trick play (see §2) does not count.
- **Average plane lifespan:** ~15–30 seconds in 2-plane matches; shorter in 8-plane Dogfight mode.
- **Combat altitude band:** most action should cluster in the middle ~40% of the playfield (roughly 30–70 % of height).
- **Ceiling stall line:** ~95 % of playfield height. The top ~5 % is the "graze = stall" zone.

**Definition — "competent player":** a tester with ≥ 5 matches of familiarity, playing normally rather than deliberately hunting for stall tricks. This is the audience §19's feel check assumes.

---

## 3. Priority Tiers & Decision Hierarchy

No deadline is imposed. These tiers exist to guide *build order* and tell the implementing agent what to protect first when design trade-offs surface.

### 3.1 Non-negotiable (must be correct and feel right)

- The physics core: 360° rotation, pitch-speed coupling, stall + recovery, horizontal wrap.
- The combat core: 2-bullet cap, straight-line constant-speed bullets, 1-shot kills, accurate hitbox behaviour.
- The match loop: 8 lives, respawn on crash, last survivor wins.
- Two-human local play on a desktop keyboard.
- 60 fps on a mid-range desktop.
- **The feel charter in §2.** If a mechanical rule reads correctly but the result feels wrong (matches dragging, stalls dominating, takeoff punishing), the implementing agent should flag it rather than ship literal compliance.

### 3.2 Preferred (important; land after non-negotiable)

- AI bot at medium difficulty.
- Scaling up to 8 planes, including the collision-rule switch and its signalling.
- Mobile phone 2P (landscape, cramped but playable) with virtual touch controls is a v1 requirement. Tablet 2P is a more comfortable target within the same build.
- Hard-difficulty AI.
- Respawn / explosion animation, match-end screen, restart flow.

### 3.3 Nice-to-have (polish; can iterate indefinitely)

- Full art pass aligned to the north star in §15.
- Easy-difficulty AI (after medium exists).
- Auto-start warning-pulse animation (the 2s/1s visual cue).
- Additional environments, palette variants, cosmetic options.

### 3.4 Decision hierarchy when trade-offs appear

1. **Feel over feature.** If we must drop a feature to keep the feel charter intact, drop the feature.
2. **Desktop non-negotiables take precedence over mobile.** Phone 2P (§3.2, §6, §14) is a v1 requirement; it can only be deferred if it would *materially harm* desktop non-negotiables (§3.1). Default assumption: both ship together.
3. **Two humans over eight planes.** If 8-plane scaling produces a messy codebase or a wobbly physics loop, cap at four temporarily and revisit.
4. **Clarity over cleverness.** If a mechanic is elegant but confusing (the 4/5 collision switch is the canonical example), default to the simpler, better-signalled version.

---

## 4. Deliverables

1. A working game playable by opening `index.html` in a modern browser, or by serving the build output over any static file host (GitHub Pages, Netlify, itch.io, a plain `python -m http.server`).
2. All game logic in plain HTML/CSS/JS (or compiled to such). Dev-time tooling (TypeScript, bundlers, linters) is unrestricted — only the shipped artefact must be standards HTML/JS/CSS.
3. A **setup & lobby screen** (see §13) that precedes every match, lets the user configure human count / AI count / AI difficulty, and displays the resulting collision mode, plane count, and controls.
4. A single source of truth for tunable constants (`config.js` or equivalent) covering physics, speeds, cooldowns, dimensions. Reviewers and playtesters will tune these.
5. A short README covering: how to run locally, how to build for static deployment, controls, how to change difficulty.
6. Placeholder art is acceptable for v1; final art direction (see §16) is layered at polish.

---

## 5. Build Phases (iterative)

Build in this order. Each phase should be demo-able before moving to the next.

1. **Skeleton** — 16:9 letterboxed canvas, fixed playfield, HUD strip, runway, central tower drawn.
2. **Single plane, in-air physics** — free 360° rotation, constant thrust, climb/dive speed coupling, stall + recovery, horizontal wrap, ground and top-of-screen behaviour.
3. **Takeoff & crash loop** — plane starts on runway, accelerates on action-button press, lifts off before tower, crashes on ground/tower contact, respawns.
4. **Bullets** — two-per-plane cap, constant speed, no wrap, 1-shot kill on hitbox overlap.
5. **Two local humans, shared keyboard** — P1 (A/S/D), P2 (J/K/L), side-by-side planes, full match loop with 8 lives each.
6. **Medium AI bot** — takeoff, climb, pursue, fire. Baseline only.
7. **Setup & lobby screen (v1)** — replaces hard-coded test configs. Lets the user pick human count (1–2), AI count, and AI difficulty; displays live plane count, active collision mode, and control reminders before Start. See §13.
8. **Scaling to 3–8 planes** — runway spawn alternation, collision rule switch + signalling (§9), HUD scaling.
9. **AI difficulty tiers** — easy / medium / hard.
10. **Mobile** — landscape lock, 4-touch virtual controls for 2 players, portrait "please rotate" overlay.
11. **Polish** — explosion animation, respawn delay, match-end screen, restart flow, art pass per §16.

**Interim builds may restrict setup options to match completed phases** — e.g. lock plane count to 2 until phase 8 lands, lock difficulty to medium until phase 9, hide the mobile-specific UI until phase 10. Grey out or hide unsupported options on the setup screen until the corresponding phase is complete.

---

## 6. Technical Constraints

- **Target browsers:** current and previous major versions of Chrome, Safari, Firefox, Edge.
- **Viewport:** the game world is a **fixed 16:9 logical playfield** scaled to fit the browser viewport with letterbox / pillarbox. World dimensions are constant across devices so gameplay is identical regardless of screen.
- **Mobile:** landscape-only. Portrait shows a "rotate your device" overlay. **Phone 2P (landscape) is the v1 mobile target** — cramped (~3 inches per player) but playable. Tablet 2P offers a more comfortable experience. Phone 1P-vs-AI is also supported but is not the primary mobile goal.
- **No audio** in v1.
- **No network / online play** in v1. All players share one device.
- **Framework:** open choice. Lightweight is preferred (Canvas 2D + vanilla JS/TS, or a small engine like Kaplay / Phaser 3). The README must justify the choice.

---

## 7. Arena

- Playfield is 16:9 (logical dimensions, e.g. 1920×1080; actual pixel size scales to viewport).
- Bottom ~10% of the screen is the **HUD strip**: per-player lives, match state, current collision-rule icon (§9).
- Directly above the HUD is the **runway**: a flat strip running the full width.
- **Central hut/tower** sits on the runway, centred horizontally. Default dimensions ~8% of playfield width, ~15% of playfield height. Indestructible. Solid: any plane (ground or air) overlapping the tower's hitbox crashes.
- The runway is divided into two takeoff zones: **left of the tower** and **right of the tower**.
- **Screen wrap:** horizontal only. A plane crossing the left edge reappears at the right, and vice versa. Bullets do not wrap.
- **Top of screen:** reaching the top triggers a stall (see §8).
- **Ground:** any plane whose hitbox touches the ground outside its controlled-takeoff phase crashes.

---

## 8. Physics

### 8.1 Rotation

- Planes rotate freely through 360°, continuous (not stepped).
- Angle convention: `0°` = straight up, `90°` = right, `180°` = straight down, `270°` = left. Clockwise increases the angle.
- Rotation rate is a tunable constant (e.g. 180°/sec).

### 8.2 Thrust

- On the ground: the plane is stationary at spawn. The **action button is a commit, not a throttle**: a single press engages **full power** and there is no way to throttle back or abort. From that moment the plane accelerates continuously until it either lifts off or crashes into the tower (the only ground-level obstacle, given the runway wraps horizontally and grounded planes do not collide with each other per §9.5). Releasing the button does nothing; further presses have no effect while grounded.
- Airborne: thrust is **constant at full power** and not under player control. Pitch alone governs speed (§8.3).

### 8.2.1 The action button — state machine

Each player has a single **action button** that serves both takeoff acceleration and firing. On desktop the action button is a physical keyboard key; on mobile it is a touch button. Both forms behave identically.

Its behaviour is a two-state machine keyed on the plane's grounded / airborne state:

- **While grounded:** the *first* press commits the plane to takeoff per §11. Further presses while still grounded have no effect (the plane is already at full power and cannot be aborted).
- **While airborne:** each press fires a bullet per §10, subject to the 2-bullet cap. Acceleration is no longer under player control.
- **On respawn (airborne → grounded):** the state resets; the next press commits the new taxi.

Throughout this document, the term **"action button"** refers to this input regardless of platform. Verb forms of *fire* and *accelerate* are retained where they describe the effect of a press (e.g. "the plane fires", "the AI accelerates"), but the input itself has one name.

### 8.3 Pitch coupling (speed vs climb angle)

The original games stepped pitch in 30° increments with this approximate behaviour:

- Level flight: no speed change.
- ±30° from horizontal: no meaningful speed change.
- ±60° from horizontal (i.e. 30° from vertical): significant speed loss when climbing, gain when diving.
- Straight up / straight down: maximum effect.

For v4.0 (continuous 360° rotation), replicate this as a smooth function of pitch off horizontal:

- Let `θ` = angle from horizontal (0° when level, 90° when vertical).
- Climbing: acceleration along the flight vector is `thrust − gravityComponent(θ)`. Climbs steeper than ~30° cause net deceleration, growing with `θ`.
- Diving: acceleration gains from gravity, symmetric.
- Tune so the "sweet spot" for climbing is 30° off horizontal (headings 60° / 300°), matching the original best-climb heuristic.

### 8.4 Stall

A plane enters stall state if **either**:
- Airspeed drops below `STALL_THRESHOLD`, or
- It reaches the top edge of the playfield.

While stalled:
- Thrust has no effect.
- Gravity dominates; the plane falls, keeping its horizontal velocity component.
- The player retains **rotational control**.
- The plane should look visually distressed (wobble / smoke / drooping elevators — tunable; placeholder OK).

**Recovery** requires both:
- Pitch pointing roughly straight down (within ~±15° of 180°), **and**
- Airspeed above `STALL_THRESHOLD`.

Once both hold, normal flight resumes. Low-altitude stalls are usually fatal — insufficient room to dive for speed before hitting the ground. This is intended. Stalls are an advanced tool (§2), not a punishment.

### 8.5 Horizontal wrap

When a plane's centre crosses the left or right edge, it reappears at the opposite edge at the same altitude, velocity, and heading. The transition should be seamless (render at both edges during the crossing frame).

---

## 9. Players, Spawns, Collisions

### 9.1 Player count

- **1 to 8 planes total** per match.
- At most **2 human players** (sharing one keyboard, or two sets of touch controls on mobile). Remaining planes are AI.
- Minimum 1 human + 1 opponent (AI or human).

### 9.2 Spawn layout

- Two runways: **left of tower** and **right of tower**.
- Planes are assigned alternately: plane 1 → left (facing right, toward tower), plane 2 → right (facing left), plane 3 → left, plane 4 → right, etc.
- All planes face the centre at spawn. Planes on the right runway are rendered mirrored.
- **Spacing formula** when multiple planes share one runway side:
  - Each side has a usable length from the inner edge of the tower to the outer edge of the playfield.
  - With `n` planes on a side, plane `i ∈ {1..n}` sits at position `i / (n + 1)` along that length.
  - Plane 1 (innermost on each side) is nearest the tower.

### 9.3 Plane-plane collisions (air)

- **≤ 4 planes in match ("Close Quarters" mode):** mid-air collision destroys both aircraft involved.
- **≥ 5 planes in match ("Dogfight" mode):** planes pass through each other in the air; bullets still hit plane hitboxes normally, so a plane can score a kill by firing while overlapping an opponent.

The mode is determined by total plane count at match start and does not change during a match.

### 9.4 Signalling the collision rule

The 4-vs-5 switch is a deliberate game-design choice (crowd management) and must be **clearly telegraphed** to avoid reading as a bug:

- **Pre-match / lobby:** display the current mode: "Close Quarters (2–4): Ramming ON" or "Dogfight (5–8): Pass-Through (bullets only)".
- **Match-start banner:** brief full-screen text flash on round start: e.g. "RAMMING ON" / "BULLETS ONLY".
- **HUD icon:** a small persistent indicator showing the active rule (e.g. crossed-planes vs ghost-plane icon).
- **Visual telegraph in Dogfight mode:** a short transparent / ghosting effect when two planes overlap, so the pass-through reads as intentional.

### 9.5 Plane-plane collisions (ground)

- Planes do **not** collide with each other on the ground (taxi/takeoff overlap is allowed).
- The moment a plane leaves the ground, air-collision rules apply (per §9.3).

### 9.6 Tower collision

- The tower is solid against planes (ground or air): overlap = crash.
- Bullets are **blocked** by the tower (they stop/expire on contact). Because the tower is low relative to the playfield, it offers only occasional cover — useful to planes flying very near the ground.

### 9.7 Hitboxes and collision geometry

- **Planes:** circular hitbox, radius tunable. Orientation does not affect the hitbox. Simpler and forgiving; acceptable for the chaotic-arcade feel (§2).
- **Bullets:** treated as points. To avoid tunnelling at high bullet speeds, each frame tests the bullet as a **swept segment** (last position → current position) against plane circles and the tower rectangle.
- **Tower:** axis-aligned rectangle.
- **Ground:** `y`-coordinate threshold (touch = crash).

### 9.8 Crash triggers (each costs 1 life)

- Hitting the ground in flight.
- Hitting the tower.
- Plane-plane collision (per §9.3, subject to mode).
- Being hit by a bullet.
- Stalling into the ground.

---

## 10. Combat

- **Action button** (see §8.2.1 for its state machine): grounded → commits taxi; airborne → fires a bullet (subject to the 2-bullet cap).
- Bullets travel in a **straight line** in the direction of the nose at firing time.
- Bullet speed is a **fixed constant, strictly greater than maximum plane airspeed**. Bullet velocity does **not** inherit from the firing plane.
- Bullets are 1-shot kill on any plane hitbox they touch.
- Each plane may have **at most 2 bullets alive on-screen** at once. While at cap, the plane cannot fire.
- Bullets **do not wrap** the screen — they expire at the edge.
- Bullets **pass through each other** (no bullet-bullet collision).
- Bullets are blocked by the tower (§9.6).
- Bullets **pass harmlessly through grounded planes** (plane hitbox still in contact with the runway). **Immunity ends the instant any part of the plane hitbox leaves contact with the runway — no post-liftoff grace window.** Taking off means committing; exposure is deliberate. Combined with §9.5, this provides a brief natural invulnerability during spawn and taxi — no explicit respawn-invulnerability timer is needed.
- **Self-kill is a firm v1 rule.** A plane can be hit by its own bullet — for example, by turning tightly into its own line of fire. This exists for physical consistency, not as a gameplay threat. Because bullets do not wrap, self-kill is vanishingly rare in practice.

---

## 11. Takeoff & Auto-Start

- On spawn, the plane sits stationary in its runway slot facing the tower.
- Pressing the **action button** (§8.2.1) engages full power immediately; there is no throttle-back (§8.2). The plane accelerates continuously along the runway until it lifts off or crashes into the tower. A player cannot abort an engaged taxi.
- The plane takes off naturally when airspeed exceeds the lift-off threshold and it leaves the runway surface.
- **Anti-camping auto-start:** if the player has not pressed the action button within **5 seconds of spawn (or respawn)**, the plane auto-accelerates at full power.
  - Because any press commits the plane, the 5 s timer has **trivial reset semantics**: it counts down from spawn until *either* the player presses the action button, *or* auto-start fires. There is no intermediate "taxi-stopped" state to reset from.
  - At **T−2 s** and **T−1 s**, a small flashing / glowing warning indicator appears on or near the plane — a subtle cue, not a rescue alarm.
  - Once auto-started, acceleration was forced — the player has no way to abort it. Because the plane faces the tower, auto-start typically ends in a crash. That is the intended punishment for runway-camping.

---

## 12. Match Rules

- Each player starts with **8 lives**.
- Every crash costs 1 life.
- After a crash: ~1.5 s explosion animation, then respawn at the assigned runway slot facing the original direction.
- When lives reach 0, the player no longer respawns.
- The match ends when only one player (human or AI) remains. Simultaneous last-two collision = draw.
- If the last human is eliminated while AI opponents remain, the match **continues to its natural conclusion** — we respect the AI as a real opponent and let it fight to the finish.
- **Skip-to-result (AI-only continuation):** while the match is playing out with no humans left alive, a clearly visible "Skip to result" button appears on-screen. Pressing it ends the AI-vs-AI continuation immediately and declares the AI currently leading in lives remaining the winner (ties → draw). This is an **accepted approximation** — not a simulation of who would actually have won had the match played to its natural end. Players who care about the true outcome can choose not to skip.
- The result screen **names the winner explicitly**, including AI winners (e.g. "PLAYER 2 WINS", "BOT RED WINS", "DRAW").
- HUD score = **lives remaining**. No separate kill counter. Lives are what matter because this is a survival contest, not a kill-count contest — the emotional currency is "how close am I to being out?".
- **Respawn safety:** a respawning plane lands back on its runway slot in the grounded state, and therefore benefits from grounded-immunity (§10) against any bullets in flight at that moment. No separate respawn-shield logic is required.
- After match end, show a result screen with a "play again" button.

---

## 13. Setup & Lobby

Before a match begins, the player sees a **setup screen** that configures the upcoming match and displays relevant rules.

### 13.1 Required controls on the setup screen

- **Human count:** 1 or 2 humans.
- **AI count:** 0 to 7 AI opponents, constrained so that total planes (humans + AI) is between 2 and 8.
- **AI difficulty:** easy / medium / hard, applied uniformly to all AI in the match.
- **Start button.**

### 13.2 Required information displayed on the setup screen

- **Total plane count** (updated live as human / AI counts change).
- **Active collision mode** for the chosen plane count, with a short human-readable explanation:
  - 2–4 total planes → "**Close Quarters — Ramming ON**. Mid-air collisions destroy both planes."
  - 5–8 total planes → "**Dogfight — Bullets Only**. Planes pass through each other. Only bullets kill."
- **Control reminder** (per-player key map on desktop, per-player touch layout on mobile) so both players see how their controls will work.

### 13.3 Flow

- Default state on first launch: 1 human, 1 medium AI (simplest matchup).
- Settings persist for the session (not cross-session — no storage required in v1).
- On "Play again" after a match, the setup screen reappears with the previous settings pre-filled.

---

## 14. Controls

### 14.1 Desktop

| Action                           | Player 1 | Player 2 |
| -------------------------------- | -------- | -------- |
| Rotate CCW                       | `A`      | `J`      |
| **Action button** (accel / fire) | `S`      | `K`      |
| Rotate CW                        | `D`      | `L`      |

- Rotation keys rotate continuously while held.
- The **action button** (§8.2.1) is a press-to-commit on the ground and a press-to-fire in the air — its platform key on desktop is listed above.
- Global keys: `Esc` = pause, `R` = restart current match (from pause menu).

### 14.2 Mobile

- Landscape only. Portrait shows a "please rotate" overlay.
- Each player gets two touch controls: a **rotate control** (left/right buttons, or a horizontal rotation slider — not a full 8-way stick, because rotation is the only steering axis) and an **action button** (§8.2.1).
- P1 controls occupy the left half of the screen; P2 the right. Independent multitouch (4+ simultaneous touches required; modern phones support ≥10).
- **Device suitability for v1:** **phone 2P (landscape) is the required mobile target.** ~3 inches per player is cramped but playable. Tablet provides a more comfortable 2P experience. Phone 1P-vs-AI is also supported.

---

## 15. AI

### 15.1 Baseline behaviour

- Performs a standard takeoff (brief pause, accelerate, lift off).
- Climbs to a target altitude band.
- Tracks the nearest opponent and rotates to aim.
- Fires when the aim is within tolerance and bullets are available.
- Avoids the ground and the tower.

### 15.2 Difficulty tiers

- **Easy:** slow rotation response, wide firing-arc tolerance, no predictive aim, occasionally panics into a stall.
- **Medium:** smooth aim, leads bullets slightly, avoids terrain competently. *Implementation order: medium first.*
- **Hard:** predictive aim accounting for bullet travel time and opponent trajectory, manages altitude aggressively, occasionally uses the tower for cover.

### 15.3 Not required

- Cooperative AI, team AI, or inter-AI communication.
- Learning / adaptive AI. Rule-based state machines are expected.

---

## 16. Visual Direction

### 16.1 North star

*Luftrausers* silhouette readability and *R-Type* arcade clarity, crossed with cutesy, light-hearted cartoon sensibility. This is a bright, fast, funny sky-fight — we are not "crashing biplanes" in any serious sense.

### 16.2 Specifics deferred to polish

The following remain open. They will be decided before the polish pass but do not block early phases (placeholder art is fine):

- **Era / setting:** WWI biplanes? Interwar barnstorming? Fictional?
- **Ground environment:** grass airfield? Carrier deck? Other?
- **Tower specifics:** small wooden hut? Lighthouse? Control tower?
- **Sky treatment:** flat colour? Painted clouds? Parallax layers?
- **Palette:** saturated primaries? Limited palette?
- **Line / shading style:** thick outlines flat fill? No outlines soft shading? Pixel art?
- **Animation style:** smooth tweened? Low-frame-count cel?
- **HUD tone:** in-world (painted signboards) or modernist overlay?

### 16.3 Constant expectations regardless of polish

- Each player's plane has a distinct signature colour, matched on the HUD.
- Stall state must be visually obvious (wobble, smoke, limp controls) — required for feel clarity.
- Bullets must be readable against both sky and ground.

---

## 17. Out of Scope (v1)

- Networked / online multiplayer.
- Audio (music, SFX).
- Persistent accounts, leaderboards, stats.
- Customisable key bindings.
- Gamepad support.
- Level editor, variable maps, weather.
- Team modes, power-ups, weapon variety.
- Friendly-fire toggle UI (friendly fire among teammates is N/A; self-kill is on, §10).

---

## 18. Tunable Constants (expose in one config module)

- World size (logical width / height).
- Gravity.
- Thrust (in-air acceleration along flight vector).
- Rotation rate (deg/sec).
- Stall threshold airspeed.
- Top-of-screen stall line.
- Lift-off speed threshold.
- Pitch-vs-speed curve parameters.
- Bullet speed, bullet lifetime (if distinct from edge expiry), per-plane bullet cap.
- Plane hitbox radius.
- Tower dimensions and position.
- Ground y-coordinate.
- Respawn delay, auto-start idle time, auto-start warning timings.
- Starting lives.
- AI per-tier parameters (rotation speed, aim tolerance, reaction time, prediction on/off).

---

## 19. Acceptance Criteria

- Opening the shipped `index.html` in a current Chrome / Safari / Firefox / Edge loads the game with no console errors.
- The **setup screen** (§13) correctly shows the collision-mode label, live plane count, and per-player control reminders; selecting 2 humans + 0–6 AI + medium difficulty starts a corresponding match.
- A 2-human match, 2-plane, plays from setup to result screen without crashes over a 5-minute session.
- An 8-plane match (2 human + 6 AI on hard) runs at ≥ 60 fps on a mid-range laptop.
- **Mobile acceptance:** a **2-human phone session** on an iPhone 12-equivalent in landscape runs at ≥ 60 fps, handles **four simultaneous independent touches** responsively (both players' rotate + action-button inputs register without drop-out), and both players' controls are legible on a ~6-inch screen.
- All physics constants are in one file and editing them changes gameplay without edits elsewhere.
- Stall, recovery, wrap, bullet cap, tower block, grounded-immunity, collision-rule signalling, skip-to-result, and setup screen are each demonstrable via a short manual test plan included in the README.
- **Feel check (qualitative).** With a pair of competent players (§2.1), a sample 2-human match should *feel* like the charter describes: chaotic-arcade pacing, marksmanship-driven, stalls rare and mostly deliberate, takeoff routine, most action well above the tower. The §2.1 anchors are indicators that tuning is in the right neighbourhood, not pass/fail numbers. If the game feels wrong but hits the anchors, retune; if it feels right but misses them slightly, leave it alone.

---

## 20. Open Questions / Deferred Decisions

1. **Visual polish specifics (§16.2).** North star is locked (Luftrausers × R-Type × cutesy). Sub-items (era, palette, ground, tower, sky, line style, animation, HUD tone) will be decided before the polish pass.

---

*End of draft v4.3.*
