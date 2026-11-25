export async function extractAccentFromImage(
  imageUrl: string
): Promise<{ hex: string; glow: string } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);

        canvas.width = 24;
        canvas.height = 24;
        ctx.drawImage(img, 0, 0, 24, 24);
        const { data } = ctx.getImageData(0, 0, 24, 24);

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const cr = data[i];
          const cg = data[i + 1];
          const cb = data[i + 2];
          // Игнорируем слишком тёмные и выцветшие пиксели
          const max = Math.max(cr, cg, cb);
          const min = Math.min(cr, cg, cb);
          if (max < 45 || max - min < 20) continue;
          r += cr;
          g += cg;
          b += cb;
          count++;
        }

        if (count === 0) return resolve(null);

        // Слегка осветляем цвет для хорошей читаемости на тёмном фоне
        const fr = Math.min(245, Math.round(r / count + 35));
        const fg = Math.min(245, Math.round(g / count + 35));
        const fb = Math.min(245, Math.round(b / count + 35));

        resolve({
          hex: `rgb(${fr}, ${fg}, ${fb})`,
          glow: `rgba(${fr}, ${fg}, ${fb}, 0.22)`,
        });
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
  });
}