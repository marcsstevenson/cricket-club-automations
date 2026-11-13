// Exports the "Game Day Snaps" WhatsApp group from WhatsApp Web, for scripts/import-whatsapp-snaps.mjs.
//
// 1. In Chrome, open web.whatsapp.com and the Game Day Snaps chat. Chrome must allow
//    web.whatsapp.com to download multiple files (chrome://settings/content/automaticDownloads).
// 2. Click the first photo you want (the oldest; or the first new one since the last run)
//    to open the photo viewer.
// 3. Paste this file into the DevTools console. It steps through every photo to the end of
//    the chat, saving each as gds_<content hash>.jpg in Downloads, then scrolls the chat to
//    read the captions and saves gds_meta.json.
// 4. Run `node scripts/import-whatsapp-snaps.mjs`.
// Videos are skipped. Photos WhatsApp Web can't load (old shared history) are skipped too.

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const save = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const mainImg = () => {
    let best = null, area = 0;
    for (const i of document.querySelectorAll('img,video')) {
      if (i.closest('#main,#pane-side,[role=listitem]') || !(i.src || '').startsWith('blob:')) continue;
      const r = i.getBoundingClientRect();
      if (r.width > 200 && r.width * r.height >= area) { area = r.width * r.height; best = i; }
    }
    return best;
  };
  const header = () => {
    const els = [...document.querySelectorAll('div,span')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top < 80 && r.left < 500 && / at \d{1,2}:\d{2}/.test(e.innerText || '') && e.innerText.length < 120;
    });
    els.sort((a, b) => a.innerText.length - b.innerText.length);
    return els[0]?.parentElement?.innerText || els[0]?.innerText || '';
  };
  const next = () => {
    const b = [...document.querySelectorAll('[aria-label="Next"]')].pop();
    if (!b || b.getAttribute('aria-disabled') === 'true') return false;
    b.click();
    return true;
  };

  // 1. Photos, from the open one to the end.
  const media = {};
  for (;;) {
    let m = null;
    for (let t = 0; t < 15 && !m; t++) {
      const c = mainImg();
      if (c && (c.tagName === 'VIDEO' || c.naturalWidth > 300)) m = c;
      else await sleep(300);
    }
    if (m && m.tagName === 'IMG') {
      const blob = await (await fetch(m.src)).blob();
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      const name = `gds_${hash}.jpg`;
      if (!media[name]) { save(blob, name); await sleep(250); }
      media[name] = header();
    }
    const prev = mainImg()?.src;
    if (!next()) break;
    for (let t = 0; t < 10 && mainImg()?.src === prev; t++) await sleep(250);
    await sleep(300);
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(1000);

  // 2. Captions: scroll the chat from the top, reading each message and its date divider.
  const first = document.querySelector('#main [data-id]');
  let sc = first;
  while (sc && !(sc.scrollHeight > sc.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  let row = first;
  while (row.parentElement && row.parentElement.children.length < 10) row = row.parentElement;
  const list = row.parentElement;
  const msgs = new Map();
  const grab = () => {
    let date = null;
    for (const c of list.children) {
      const m = c.querySelector('[data-id]');
      if (!m) { const t = c.innerText.trim(); if (t) date = t; continue; }
      const txt = m.innerText;
      if (txt.trim() && !msgs.has(m.dataset.id)) {
        msgs.set(m.dataset.id, { date, lines: txt.split('\n').map((s) => s.trim()).filter(Boolean) });
      }
    }
  };
  for (let i = 0; i < 30; i++) { sc.scrollTop = 0; await sleep(1200); }
  for (let i = 0; i < 400; i++) {
    grab();
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5) break;
    sc.scrollTop += sc.clientHeight * 0.5;
    await sleep(800);
  }
  grab();

  save(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), media, captions: [...msgs.values()] }, null, 1)], { type: 'application/json' }), 'gds_meta.json');
  console.log(`Saved ${Object.keys(media).length} photos and ${msgs.size} messages`);
})();
