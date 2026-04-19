This is a **strong** prompt for an implementing model: it defines the game loop, phased delivery, technical constraints, tunable constants, and acceptance criteria clearly enough to get a credible first build.  Its main weakness is that it mixes fixed requirements, design hypotheses, and unresolved questions, so a builder could implement the wrong “feel” while still technically satisfying the brief.[1]

## What works

The document gives the model a concrete target: a static-site, browser-based 2D biplane dogfight game with a fixed 16:9 playfield, local multiplayer focus, staged milestones, and explicit deliverables including README and config exposure.  That combination is excellent for browser development because it reduces architectural drift and encourages something playable early rather than a monolithic “build the whole game” attempt.[1]

The best parts are the phased build order, the tunable-constants requirement, and the acceptance criteria around stall, wrap, bullet cap, tower blocking, and performance on desktop and mobile.  Those sections give the implementing agent somewhere to stand when trade-offs appear, and they implicitly encourage parameterised gameplay rather than hard-coded magic numbers.[1]

## Main issues

The prompt over-specifies some mechanics while under-specifying the player experience.  For example, physics, spawn rules, bullet behaviour, anti-camping, AI tiers, HUD, mobile controls, and performance targets are all defined, but there is no explicit statement of the intended match tempo, average survival time, desired skill ceiling, or whether the game should feel “chaotic arcade” or “tight duel sim-lite”.[1]

There is also hidden scope creep: v1 is nominally local-only and static-site simple, yet it includes desktop, mobile, AI in three tiers, support for up to eight planes, 60 fps targets, a full match loop, and a visual polish phase.  That is achievable, but not all at the same fidelity, so the prompt should rank those requirements rather than presenting them as roughly equal.[1]

## Assumptions to challenge

I would challenge the assumption that mobile two-player local multiplayer is worth doing in v1. The prompt asks for landscape lock, four-touch controls, split-screen touch zones, and responsive play on an iPhone 12-class device, but this game’s appeal seems strongest on a shared keyboard or large screen where spatial awareness and simultaneous input are cleaner.[1]

The collision-rule switch at four versus five planes is clever for crowd management, but it may feel inconsistent unless the game telegraphs it very clearly in setup and HUD.  A player can reasonably ask why ramming works in one match size and not another, so that rule needs either stronger thematic justification or replacement with a more consistent simplification.[1]

## Improve the brief

Split the prompt into three labelled tiers: “non-negotiable”, “preferred”, and “nice-to-have”. Right now, static deployment, local multiplayer, mobile support, AI difficulty tiers, art direction exploration, and 60 fps targets sit together in a way that makes prioritisation ambiguous.[1]

Add a short “game feel charter” of five to eight bullet points. It should define intended pacing, match length, difficulty curve, how often stalls should occur, whether take-off should feel stressful or routine, and whether mastery should come more from energy management, aim, or tower/runway mind games. That would complement the current mechanical precision around thrust, pitch coupling, stall recovery, and runway behaviour.[1]

Tighten implementation ambiguities. The brief should explicitly define whether planes have circular or oriented hitboxes, whether bullets are ray/point/projectile-body collisions, how spawn spacing behaves when many planes share one runway, and whether self-kill is on or off in v1 instead of leaving it half-open.[1]

## Questions to send back

| Area | Question | Why it matters |
|---|---|---|
| Core fantasy | Is the target feel closer to *Sopwith*-style readable arcade tactics or a more chaotic party game? [1] | This determines whether physics should favour precision, recovery, and duelling, or spectacle and frequent crashes. |
| Platform priority | Is desktop the primary target, with mobile only as a stretch goal for v1? [1] | This affects control design, UI density, and whether touch compromises should shape the whole game. |
| Scope control | If time runs short, which drops first: mobile, 8-plane support, hard AI, or polish? [1] | The current prompt does not declare a sacrifice order. [1] |
| Fairness | Should grounded-plane bullet immunity remain, or would a short timed respawn shield be clearer? [1] | “Grounded means invulnerable” is elegant, but may create edge cases around lift-off frames and runway grazing. [1] |
| Match structure | Why is HUD score “lives remaining” rather than kills, rounds won, or both? [1] | That choice changes player psychology and how satisfying aggression feels. |
| Visual coherence | Which single art reference is the north star from the list in §17.1? [1] | Without one anchor, “cartoonish, semi-realistic, whimsical” can still produce a muddled result. [1] |

The single biggest improvement would be to add one page called “decision hierarchy”: what must be preserved if implementation trade-offs appear, and what can bend.  At the moment, the prompt is excellent at describing the machine, but slightly less certain about the intended play experience.[1]