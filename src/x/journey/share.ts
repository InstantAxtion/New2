// The trip summary as a picture, to share or keep.

export interface CardData {
  title: string;
  big: string;
  sub: string;
  rows: [string, string][];
  foot: string;
}

/** Draw the summary card (1080 × 1080). */
export function drawCard(d: CardData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 1080;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 1080);
  bg.addColorStop(0, '#1b2a4a');
  bg.addColorStop(0.55, '#3a3558');
  bg.addColorStop(1, '#f0a35c');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1080, 1080);
  // A road running to the horizon
  g.fillStyle = 'rgba(10,14,24,.55)';
  g.beginPath();
  g.moveTo(500, 760);
  g.lineTo(580, 760);
  g.lineTo(980, 1080);
  g.lineTo(100, 1080);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.lineWidth = 6;
  g.setLineDash([36, 30]);
  g.beginPath();
  g.moveTo(540, 770);
  g.lineTo(540, 1080);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(8,12,22,.5)';
  g.fillRect(0, 0, 1080, 760);

  const font = (px: number, w = 600) => `${w} ${px}px Inter, system-ui, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#f0b44c';
  g.font = font(34, 800);
  g.fillText('ENDLESS DRIVE', 80, 120);
  g.fillStyle = '#f4f6fb';
  g.font = font(40);
  g.fillText(d.title, 80, 190);
  g.font = font(170, 800);
  g.fillText(d.big, 72, 370);
  g.fillStyle = '#c9d2e4';
  g.font = font(40, 400);
  g.fillText(clip(g, d.sub, 920), 80, 440);
  let y = 530;
  for (const [k, v] of d.rows.slice(0, 5)) {
    g.fillStyle = '#aab4c8';
    g.font = font(32, 400);
    g.fillText(k, 80, y);
    g.fillStyle = '#f4f6fb';
    g.font = font(34);
    g.textAlign = 'right';
    g.fillText(clip(g, v, 640), 1000, y);
    g.textAlign = 'left';
    y += 54;
  }
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.font = font(28, 400);
  g.fillText(d.foot, 80, 1040);
  return c;
}

function clip(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 3 && g.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t + '…';
}

/** Share the picture if the phone can, otherwise save it; 'shown' means neither worked and the caller should display it. */
export async function shareCanvas(c: HTMLCanvasElement, text: string): Promise<'shared' | 'saved' | 'shown'> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (blob) {
    const file = new File([blob], 'endless-drive-trip.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text });
        return 'shared';
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
    // In the app's own window a download goes nowhere: show the picture instead
    const native = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    if (!native) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'endless-drive-trip.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return 'saved';
    }
    try {
      if (nav.share) {
        await nav.share({ text });
        return 'shared';
      }
    } catch {
      /* fall through */
    }
  }
  return 'shown';
}
