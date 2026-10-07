/* Analyze drawings away from the UI thread so the editor remains interactive. */
importScripts('/floor-plan-furniture.js?v=2');
self.onmessage = ({ data: { id, pixels, plan, mode } }) => {
  try {
    if (mode !== 'furniture') throw new Error('Structural recognition must use the pretrained floor plan service.');
    const detected = (plan.walls || []).filter(wall => wall.kind === 'wall');
    const length = wall => Math.hypot((wall.b[0] - wall.a[0]) * pixels.width, (wall.b[1] - wall.a[1]) * pixels.height);
    const totalLength = detected.reduce((sum, wall) => sum + length(wall), 0);
    const contains = (item, wall) => {
      const halfX = item.width / plan.width / 2 + 5 / pixels.width, halfY = item.depth / plan.depth / 2 + 5 / pixels.height;
      return [wall.a, wall.b].every(p => Math.abs(p[0] - item.center[0]) <= halfX && Math.abs(p[1] - item.center[1]) <= halfY);
    };
    // A small building surrounded by page margins looks like an isolated object.
    // Furniture proposals must never erase the dominant structural layout.
    const all = FloorPlanFurniture.suggest(pixels, { ...plan, furniture: [] }).filter(item =>
      !totalLength || detected.filter(wall => contains(item, wall)).reduce((sum, wall) => sum + length(wall), 0) < totalLength * .5);
    const furniture = all.filter(item => !(plan.furniture || []).some(existing => {
      const dx = (existing.center[0] - item.center[0]) * plan.width, dy = (existing.center[1] - item.center[1]) * plan.depth;
      return Math.hypot(dx, dy) < Math.max(item.width, item.depth) * .4;
    }));
    self.postMessage({ id, walls: [], furniture });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
