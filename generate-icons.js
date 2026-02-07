const { createCanvas } = require('canvas');
[16, 48].forEach(size => {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff6b35';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.floor(size * 0.6)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', size/2, size/2);
  require('fs').writeFileSync(`icon${size}.png`, c.toBuffer('image/png'));
});
console.log('Icons generated');
