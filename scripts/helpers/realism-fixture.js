'use strict';
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII=';
const segment = (kind, a, b) => ({ kind, a, b });
const item = (type, center, width, depth, rotation = 0, extra = {}) => ({ type, center, width, depth, rotation, ...extra });
const finish = (pattern, color, accent, scale) => ({ pattern, color, accent, scale, rotation: 0 });
function realismFloor() {
  return { version: 1, image: pixel, width: 36, depth: 32, height: 10, thickness: .5, scaleConfirmed: true, openingDetectionVersion: 4,
    walls: [segment('wall', [.05,.05], [.95,.05]), segment('wall', [.95,.05], [.95,.95]), segment('wall', [.95,.95], [.05,.95]), segment('wall', [.05,.95], [.05,.05]),
      segment('wall', [.62,.05], [.62,.95]), segment('wall', [.05,.4], [.62,.4]), segment('wall', [.62,.45], [.95,.45]), segment('wall', [.62,.7], [.95,.7]),
      segment('door', [.26,.95], [.35,.95]), segment('door', [.3,.4], [.39,.4]), segment('door', [.62,.3], [.62,.39]), segment('door', [.62,.54], [.62,.63]), segment('door', [.62,.78], [.62,.87]),
      segment('window', [.15,.05], [.36,.05]), segment('window', [.72,.05], [.85,.05]), segment('window', [.05,.52], [.05,.7]), segment('window', [.95,.76], [.95,.9])],
    furniture: [item('sofa', [.15,.6], 7, 3, -90), item('table', [.32,.61], 3, 2), item('rug', [.32,.61], 8, 7), item('dining_table', [.44,.8], 6, 4),
      item('kitchen_counter', [.32,.105], 13, 2), item('sink', [.53,.24], 3, 2, 90), item('bed', [.78,.2], 5, 6.5), item('wardrobe', [.91,.26], 5, 2, 90),
      item('curtains', [.78,.075], 6, .5, 0, { height: 8.5 }), item('toilet', [.72,.5], 2, 2.5), item('shower', [.89,.52], 3, 3), item('bath', [.84,.64], 2.5, 5.5, 90),
      item('lamp', [.1,.75], 1.5, 1.5), item('ceiling_light', [.32,.61], 2.5, 2.5), item('ceiling_light', [.78,.24], 2, 2),
      item('plant', [.9,.9], 2, 2), item('railing', [.8,.925], 9, .5), item('stairs', [.1,.24], 3.5, 9, 0, { height: 10 })],
    finishes: { wall: finish('solid', '#eee9de', '#ffffff', 2), exterior: finish('plaster', '#d8d2c2', '#e9e2d3', 3), floor: finish('wood', '#c5a580', '#917450', 4), ceiling: finish('solid', '#faf8f1', '#ffffff', 2) },
    presentation: { skirting: true, trims: true, roof: 'flat', lighting: 'day', views: [
      { name: 'Entrance', center: [.3,.88], heading: 0, notes: 'Illustrative entrance view. Door joinery, hardware and skirting are modelled.' },
      { name: 'Living room', center: [.45,.56], heading: 90, width: 19.5, depth: 17, notes: 'Sample wood flooring, upholstered seating and a ceiling fitting. These are demonstration finishes.' },
      { name: 'Kitchen', center: [.32,.29], heading: 0, width: 19.5, depth: 10.5, notes: 'Cabinet fronts, handles, worktop, hob and sink illustrate the fitted kitchen.' },
      { name: 'Bedroom', center: [.78,.37], heading: 0, width: 11, depth: 12, notes: 'A dimensioned bed, wardrobe and folded curtains show how the space can be furnished.' },
      { name: 'Balcony', center: [.78,.82], heading: -90, width: 11, depth: 7, notes: 'A railing and planting illustrate the balcony fittings. Review this example against your own project.' }
    ] } };
}
async function drawingImage(page, floor) {
  return page.evaluate(plan => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 800;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 800);
    for (const wall of plan.walls) {
      ctx.beginPath(); ctx.moveTo(wall.a[0] * 900, wall.a[1] * 800); ctx.lineTo(wall.b[0] * 900, wall.b[1] * 800);
      ctx.strokeStyle = wall.kind === 'wall' ? '#3b4942' : wall.kind === 'door' ? '#fff' : '#70b9ca'; ctx.lineWidth = wall.kind === 'wall' ? 12 : 14; ctx.stroke();
    }
    ctx.font = '20px Arial'; ctx.fillStyle = '#54655b';
    for (const view of plan.presentation.views) ctx.fillText(view.name, view.center[0] * 900 - 25, view.center[1] * 800);
    return canvas.toDataURL('image/png');
  }, floor);
}
module.exports = { realismFloor, drawingImage, pixel };
