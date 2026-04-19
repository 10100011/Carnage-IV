import { STROKE, TOWER, VISUAL, WORLD } from './config';

/**
 * Draw the static arena: sky, runway surface, central tower, HUD strip.
 * Called every frame inside the logical-coord transform. T1.2 / §7.
 */
export function drawArena(ctx: CanvasRenderingContext2D): void {
  // Sky fills everything above the ground line.
  ctx.fillStyle = '#7bb5e3';
  ctx.fillRect(0, 0, WORLD.width, WORLD.groundY);

  // Runway surface — thin tan band at the top of the ground region.
  ctx.fillStyle = '#a89268';
  ctx.fillRect(
    0,
    WORLD.groundY - VISUAL.runwayThickness,
    WORLD.width,
    VISUAL.runwayThickness,
  );

  // Tower — solid block centred on the runway (§7). Outline for definition.
  const towerLeft = TOWER.centreX - TOWER.width / 2;
  ctx.fillStyle = '#5c6b73';
  ctx.fillRect(towerLeft, TOWER.topY, TOWER.width, TOWER.height);
  ctx.strokeStyle = '#2e3538';
  ctx.lineWidth = STROKE.object;
  ctx.strokeRect(towerLeft, TOWER.topY, TOWER.width, TOWER.height);

  // HUD strip — bottom 10% of playfield (§7), sits below the ground line.
  ctx.fillStyle = '#14192a';
  ctx.fillRect(0, WORLD.groundY, WORLD.width, WORLD.hudHeight);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = STROKE.divider;
  ctx.beginPath();
  ctx.moveTo(0, WORLD.groundY);
  ctx.lineTo(WORLD.width, WORLD.groundY);
  ctx.stroke();

  // Ceiling stall line — §2.1 (top ~5% graze-zone), §8.4. Faint dashed
  // indicator while stall visual feedback is still placeholder-only; can be
  // removed once stalls are otherwise unmistakable (wobble, smoke, etc.).
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = STROKE.divider;
  ctx.setLineDash([12, 12]);
  ctx.beginPath();
  ctx.moveTo(0, WORLD.ceilingStallY);
  ctx.lineTo(WORLD.width, WORLD.ceilingStallY);
  ctx.stroke();
  ctx.setLineDash([]);
}
