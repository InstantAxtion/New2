import type { Ctx } from '../core';
import { deletePhoto, listPhotos, onAlbumChange, sharePhoto, ALBUM_MAX, type Photo } from './capture';

// The photo album: a grid of the pictures you've taken, and a big view to share or delete one.

export function mountAlbum(ctx: Ctx) {
  const body = ctx.sheet('album', '🖼️ Album');
  body.classList.add('album-body');
  const viewer = document.createElement('div');
  viewer.id = 'album-view';
  viewer.innerHTML = `<img alt="" /><div class="av-cap"></div>
<div class="av-btns"><button class="icon" data-av="prev" aria-label="Previous">◀</button>
<button class="ghost small" data-av="share">📤 Share or save</button>
<button class="ghost small" data-av="delete">🗑️ Delete</button>
<button class="icon" data-av="next" aria-label="Next">▶</button></div>
<button class="icon av-close" data-av="close" aria-label="Close">✕</button>`;
  document.getElementById('ui')!.appendChild(viewer);
  const img = viewer.querySelector('img')!;
  const cap = viewer.querySelector('.av-cap') as HTMLElement;

  let photos: Photo[] = [];
  let urls: string[] = [];
  let at = -1;
  let bigUrl = '';
  let confirmDel = false;

  const show = (i: number) => {
    if (!photos.length) return hide();
    at = (i + photos.length) % photos.length;
    const p = photos[at];
    if (bigUrl) URL.revokeObjectURL(bigUrl);
    bigUrl = URL.createObjectURL(p.blob);
    img.src = bigUrl;
    const when = new Date(p.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    cap.textContent = [p.meta.caption ?? p.meta.region, p.meta.kind === 'postcard' ? 'Postcard' : '', when].filter(Boolean).join(' · ');
    confirmDel = false;
    (viewer.querySelector('[data-av="delete"]') as HTMLElement).textContent = '🗑️ Delete';
    viewer.classList.add('on');
  };
  const hide = () => {
    viewer.classList.remove('on');
    at = -1;
  };

  const render = async () => {
    try {
      photos = await listPhotos();
    } catch {
      body.innerHTML = '<p class="hint">Photos can\'t be kept on this phone (its storage is switched off).</p>';
      return;
    }
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = photos.map((p) => URL.createObjectURL(p.thumb ?? p.blob));
    if (!photos.length) {
      body.innerHTML = '<p class="hint">No photos yet. While driving, open ✨ More → 📷 Photo mode, frame the shot and press the shutter.</p>';
      return;
    }
    body.innerHTML = `<p class="hint">${photos.length} of ${ALBUM_MAX} · the oldest make room for new ones</p><div class="album-grid">${photos
      .map((p, i) => `<button class="album-cell" data-ph="${i}" aria-label="Open photo"><img src="${urls[i]}" alt="" loading="lazy" />${p.meta.kind === 'postcard' ? '<i>✉️</i>' : ''}</button>`)
      .join('')}</div>`;
    for (const b of body.querySelectorAll<HTMLElement>('[data-ph]')) b.onclick = () => show(Number(b.dataset.ph));
  };

  viewer.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-av]')?.dataset.av;
    const p = photos[at];
    if (!act) return;
    if (act === 'close') hide();
    else if (act === 'prev') show(at - 1);
    else if (act === 'next') show(at + 1);
    else if (act === 'share' && p) {
      void sharePhoto(p).then((r) => r === 'saved' && ctx.toast('Saved<b>📥 In your downloads</b>'));
    } else if (act === 'delete' && p) {
      const btn = viewer.querySelector('[data-av="delete"]') as HTMLElement;
      if (!confirmDel) {
        confirmDel = true;
        btn.textContent = '🗑️ Really delete?';
        return;
      }
      const i = at;
      void deletePhoto(p.id).then(async () => {
        await render();
        if (photos.length) show(Math.min(i, photos.length - 1));
        else hide();
      });
    }
  });
  let dirty = true;
  onAlbumChange(() => {
    dirty = true;
    if (!document.getElementById('album')!.classList.contains('hidden') && at < 0) void render();
  });

  ctx.tile({
    id: 'album', icon: '🖼️', label: 'Album', sub: 'Your photos', order: 21,
    run: () => {
      ctx.open('album');
      if (dirty) {
        dirty = false;
        void render();
      }
    },
  });
  // Leaving the screen it was opened from closes the big view too
  ctx.on('phase', () => hide());
}
