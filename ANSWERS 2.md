- Deployment target: agreed. Start with static index.html
- Build tooling tolerance: we can run with whatever we want at our end, but the end-user browser must just be a standard HTML / JS / CSS setup
  Collision / hazards
  - Plane ↔ plane mid-air collision: for 1-4 players, mid-air collision. For 4-8 users, no collision (but launching a bullet as they pass 'through' each other would score a kill). I said 1-2 players, but players 3-8 could be AI / 
- The central hut/tower: solid ground level, and slightly above ground level, obstacle. Indestructable. Collision = crash.
- Bullet ↔ bullet: Bullets have no effect on each other.
  Takeoff / respawn
- Does the aircraft accelerate automatically once the round starts, or does the player hold a thrust key? Shoot button is also accelerate when on ground. Thereafter, plane is assumed to be at full power at all times, notwithstanding stall physics.
- After a crash, does the plane respawn on its own runway facing outward? Short delay for an explosion animation, then back on starting point.
- Anti-camping auto-start: after how long? And is the plane then uncontrolled until airborne? Five seconds. Plane is then uncontrolled but will crash into hut / tower.
  Match end
  - Round ends when one player hits 0 lives → they lose? Best-of-N rounds, or single match? Player ceases to respawn when all lives have gone. Winner is the player left.
  - Scoring: just "lives remaining", or separate kill count? Lives remaining.
  AI bot
  - Difficulty tiers (easy/medium/hard), or a single baseline we tune later? Difficulty tiers.
  - Any behaviour you remember from the originals (did Carnage have a bot)? Carnage bot simply went through a standard takeoff sequence, then - once at a certain altitude - pointed towards the nearest opponent and fired at random. We can do better.
  Controls (desktop)
  - Player 1 / Player 2 keyboard layout: P1 = A (anti-clockwise), S (shoot / accelerate), D (clockwise). P2 = J,K,L
  - On mobile: yes, modern phones detect 4+ simultaneous touches — a virtual stick + fire button works. Then we can have two thumbs per player = 4 touch points.
  Viewport
  - Fixed aspect ratio (e.g. 16:9) letterboxed on odd screens, or responsive to window size? The original was CRT 4:3. Good question. Modern screens are wider, but still inconsistent. Can we accept different viewport size / ratios?