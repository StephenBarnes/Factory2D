const SPARK_DURATION_MS = 350;

/** Draw two white sparks along the joined cells' axis, fixed at the operation site. */
export function drawWeldSparks(
  context: CanvasRenderingContext2D,
  edges: Map<number, number>,
  width: number,
  height: number,
  originX: number,
  originY: number,
  cellSize: number,
): boolean {
  if (edges.size === 0) return false;
  const now = performance.now();
  context.save();
  context.beginPath();
  context.rect(originX, originY, width * cellSize, height * cellSize);
  context.clip();
  context.lineCap = "round";
  context.strokeStyle = "#fff9e8";
  context.fillStyle = "#ffffff";
  for (const [edge, startedAt] of edges) {
    const progress = (now - startedAt) / SPARK_DURATION_MS;
    if (progress >= 1) {
      edges.delete(edge);
      continue;
    }
    const index = edge >> 1;
    const horizontal = (edge & 1) === 0;
    const x = originX + ((index % width) + (horizontal ? 1 : 0.5)) * cellSize;
    const y = originY + (Math.floor(index / width) + (horizontal ? 0.5 : 1)) * cellSize;
    const distance = (0.04 + 0.65 * (1 - (1 - progress) ** 2)) * cellSize;
    const trail = (0.03 + 0.13 * (1 - progress)) * cellSize;
    const radius = Math.max(0.75, cellSize * 0.045) * (1 - progress * 0.6);
    context.globalAlpha = (1 - progress) ** 2;
    context.lineWidth = radius;
    for (let sign = -1; sign <= 1; sign += 2) {
      const dx = horizontal ? sign : 0;
      const dy = horizontal ? 0 : sign;
      const tipX = x + dx * distance;
      const tipY = y + dy * distance;
      context.beginPath();
      context.moveTo(x + dx * (distance - trail), y + dy * (distance - trail));
      context.lineTo(tipX, tipY);
      context.stroke();
      context.beginPath();
      context.arc(tipX, tipY, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
  return edges.size > 0;
}
