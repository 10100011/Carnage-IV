Background: Our game is a 2D aircraft shooter. It has a static viewport. At the bottom, a space at the bottom shows scores / lives remaining, then above it a runway. Two biplanes sit facing opposing directions, left and right of the screen. In between them, centrally, is a hut or aircraft tower. Aircraft accelerate towards the centre and take off before the tower. They then rotate around the screen shooting each other.

1. You will review your own prompt; at least one other model will also review it and offer feedback. This will continue until we have achieve a consensus. Criteria are those you suggest, plus any other which point towards an effective and robust prompt.                                                                                                                                                                       
2. Iterative agent session.                                                                                                                                                                                         
3. My memory / description, screenshots (although we expect to deliver better graphics in 2026). The gameplay is not complex.                                                                                       
4. There is no canon. We pick the most fun.                                                                                                                                                                         
5. Physics: aircraft point at angles from 0 degrees (straight up) to 330 degrees. In the original games, the aircraft could rotate at 30 degree intervals and the aircraft velocity would be affected: level flight or 30 degrees ± would not affect speed, but going up at 330 or 30 degrees would result in significant speed loss. Below a certain threshold, or if the aircraft reaches the top of the screen, the aircraft stall and plummet towards the ground (maintaining any sideways momentum they had). To recover, the aircraft must point straight down *and* reach above stall speed. Low altitude stalls are therefore fatal, as there is no space to recover. The best method is therefore to gain altitude at either 300 or 60 degrees. However, for a modern game, we should rotate the aircraft at any of 360 directions, not merely 12. Aircraft that reach the left or right edges wrap back to the other side. Aircraft that touch the ground crash; they cannot land.

6. Bullets: consistent speed irrespective of aircraft speed. Bullets always travel faster than the fastest aircraft speed. They are 1-shot-kill. They continue to the edge of the screen, then stop / expire and do not wrap, unlike the aircraft. An aircraft may only launch two bullets at a time.

7. Arena: Explained in 'Background'

8. Start with 8 lives. Lose one per crash. Aircraft cannot 'win' by staying on the ground as, after a while, they will be auto-started and would crash into the hut / tower.

9. Two players, single screen. One player may be AI / bot. Remote / online play is out of scope, for now, but may be added later.

10. N/A

11. N/A

12. Probably keyboard.

13. Virtual stick. Unsure of bullet mechanism at this point (can mobile phones detect four touches?)

14. Cartoon-ish. Semi-realistic, but somewhat whimsical.

15. Probably not. Maybe v2.

16. No preference. Wide compatibility requirement.

17. Clarify?