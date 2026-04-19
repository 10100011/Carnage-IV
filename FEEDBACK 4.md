This is the best version so far and is very close to hand-off quality.  The prompt now has a strong internal hierarchy, better setup flow, cleaner acceptance criteria, and fewer edge-case holes than the earlier drafts.[1]

## What is now solid

The addition of Setup & Lobby as an explicit deliverable is exactly right, because the collision-mode explanation, plane count, and control reminder are now part of a concrete flow instead of an implied pre-match state.  The revised mobile acceptance criterion is also much stronger because it explicitly tests two humans, four simultaneous touches, responsiveness, and legibility on a phone-sized screen.[1]

The commit-on-press runway rule is a substantial simplification.  It removes the ambiguous “taxi stopped” reset logic, aligns better with your anti-camping intent, and makes take-off behaviour easier for an implementation model to code and test consistently.[1]

## Remaining issues

The largest remaining issue is internal terminology around the ground input. §8.2 and §11 describe a single **accelerate key** with commit-on-press semantics, while §10 still says the **fire key** doubles as the accelerate key on the ground, and §14.1 still labels the input as “Accelerate/Fire”.  That is probably still understandable, but it leaves a model room to implement press-once-to-commit on the runway and press-to-fire repeatedly in the air using one button without ever stating the input-state transition explicitly.[1]

There is also a small document-integrity issue: the header says “Draft v4”, but the footer still says “End of draft v2”.  That is trivial to fix, yet exactly the sort of inconsistency that weakens confidence when this is passed between models.[1]

## Tightening suggestions

I would add one sentence explicitly defining the shared button state machine. For example: on ground, the first press on that button commits acceleration and consumes the ground state; once airborne, subsequent presses on the same button fire bullets subject to the cap. That would reconcile §8.2, §10, §11, and §14 in one stroke.[1]

I would also clarify what “off the runway” means in §8.2 when describing crashes.  At present it says the plane accelerates until it lifts off or crashes “into the tower, or off the runway”, but elsewhere the runway is described as a strip running the full width, so “off the runway” could be read as impossible unless you mean failing to achieve lift before intersecting forbidden ground geometry.[1]

## Design critique

The skip-to-result rule is sensible, but the winner shortcut is not perfectly equivalent to “natural conclusion”.  Declaring the AI with the most lives remaining as winner on skip may produce a different result than letting the AI fight it out, so if fidelity matters you may want the wording to say this is an accepted shortcut approximation rather than the true final outcome.[1]

The other design choice worth one final look is the sequencing of build phases. Setup & Lobby now arrives before scaling to 3–8 planes, which is good for product completeness, but because the lobby exposes AI count and collision mode, an implementing model may need temporary restrictions in that screen until later phases land.  It may help to say that earlier milestone builds can grey out unsupported counts and difficulties until the corresponding phases are complete.[1]

## Final pass fixes

- Make terminology consistent: choose either “accelerate/fire button” everywhere or define “shared action button” once and use that term throughout.[1]
- Fix the footer version marker from “End of draft v2” to v4.[1]
- Clarify whether “skip to result” is canonical or an approximation based on current lives.[1]
- State that interim builds may expose only the setup options already supported by completed phases.[1]

At this point, the document is no longer missing major design structure.  What remains is mostly editorial precision and one or two implementation-state clarifications.[1]

