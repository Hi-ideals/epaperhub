import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../common';
import { useSettings } from '../../context/SettingsContext';
import { post, mediaUrl } from '../../services/api';
import Comments from './Comments';
import { useMediaQuery } from '../../hooks';
import { appHref } from '../../services/tenant';

export function shareLinks(url, text) {
  const u = encodeURIComponent(url); const t = encodeURIComponent(text);
  return [
    { key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp', color: '#25D366', href: `https://wa.me/?text=${t}%20${u}` },
    { key: 'facebook', label: 'Facebook', icon: 'facebook', color: '#1877F2', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: 'telegram', label: 'Telegram', icon: 'telegram', color: '#229ED9', href: `https://t.me/share/url?url=${u}&text=${t}` },
    { key: 'x', label: 'X', icon: 'twitter-x', color: '#000', href: `https://x.com/intent/tweet?url=${u}&text=${t}` },
    { key: 'email', label: 'Email', icon: 'envelope-fill', color: '#6c757d', href: `mailto:?subject=${t}&body=${t}%0A${u}` },
  ];
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/**
 * Instagram has no web "share link" URL. Phones: open the system share sheet with the
 * image attached (Instagram appears there). Computers: download the image, copy the
 * link and open Instagram so the user can upload it.
 */
export async function shareToInstagram({ url, text, image }) {
  await copyText(url);
  let file = null;
  if (image) {
    try {
      const res = await fetch(image, { mode: 'cors' });
      const blob = await res.blob();
      file = new File([blob], `epaper-${Date.now()}.${blob.type.includes('png') ? 'png' : 'jpg'}`, { type: blob.type || 'image/jpeg' });
    } catch { file = null; }
  }
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: text, text: `${text}\n${url}` }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  if (file) {
    const href = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href, download: file.name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 3000);
  }
  toast.success(file ? 'Image downloaded and link copied — upload it on Instagram and paste the link.' : 'Link copied — paste it on Instagram.', { duration: 6000 });
  window.open('https://www.instagram.com/', '_blank', 'noopener');
}

export function ShareButtons({ url, text, compact = false, image }) {
  const { t } = useSettings();
  return (
    <div className={`d-flex flex-wrap gap-2 ${compact ? '' : 'justify-content-center'}`}>
      {shareLinks(url, text).map((l) => (
        <a key={l.key} href={l.href} target="_blank" rel="noopener noreferrer" className="share-btn" style={{ '--c': l.color }} aria-label={`Share on ${l.label}`} title={l.label}>
          <i className={`bi bi-${l.icon}`} />{!compact && <span>{l.label}</span>}
        </a>
      ))}
      <button type="button" className="share-btn share-instagram" onClick={() => shareToInstagram({ url, text, image })} aria-label="Share on Instagram" title="Instagram">
        <i className="bi bi-instagram" />{!compact && <span>Instagram</span>}
      </button>
      <button type="button" className="share-btn" style={{ '--c': '#0b2545' }} onClick={async () => { if (await copyText(url)) toast.success(t('copied')); }} title={t('copyLink')}>
        <i className="bi bi-link-45deg" />{!compact && <span>{t('copyLink')}</span>}
      </button>
      {navigator.share && (
        <button type="button" className="share-btn d-md-none" style={{ '--c': '#444' }} onClick={() => navigator.share({ title: text, url }).catch(() => {})}>
          <i className="bi bi-share" />{!compact && <span>More</span>}
        </button>
      )}
    </div>
  );
}

export function ShareModal({ show, onClose, url, title, image }) {
  const { t } = useSettings();
  return (
    <Modal show={show} onClose={onClose} title={t('share')}>
      {image && <img src={image} alt="" className="img-fluid rounded border mb-3 d-block mx-auto" style={{ maxHeight: 260 }} />}
      <p className="small text-muted mb-2">{title}</p>
      <div className="input-group mb-3">
        <input className="form-control" readOnly value={url} onFocus={(e) => e.target.select()} />
        <button className="btn btn-primary" onClick={async () => { if (await copyText(url)) toast.success(t('copied')); }}><i className="bi bi-clipboard" /></button>
      </div>
      <ShareButtons url={url} text={title} image={image} />
    </Modal>
  );
}

/** Shows the cropped area, lets the user download it or create a shareable clipping. */
const loadImg = (src) => new Promise((resolve, reject) => {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => resolve(im);
  im.onerror = reject;
  im.src = src;
});

/** Area of an image without its empty (transparent or white) border. */
function trimImage(img) {
  const w = img.naturalWidth; const h = img.naturalHeight;
  const full = { img, sx: 0, sy: 0, sw: w, sh: h };
  try {
    const k = Math.min(1, 600 / Math.max(w, h)); // scan a small copy
    const cw = Math.max(1, Math.round(w * k)); const ch = Math.max(1, Math.round(h * k));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, cw, ch);
    const d = cx.getImageData(0, 0, cw, ch).data;
    let x0 = cw; let y0 = ch; let x1 = -1; let y1 = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      if (d[i + 3] > 16 && !(d[i] > 243 && d[i + 1] > 243 && d[i + 2] > 243)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return full;
    return { img, sx: x0 / k, sy: y0 / k, sw: (x1 - x0 + 1) / k, sh: (y1 - y0 + 1) / k };
  } catch { return full; } // e.g. image from another site that can't be read
}

/** "November 5, 2026" from 'YYYY-MM-DD' */
export function longEditionDate(d) {
  const [y, m, day] = String(d).split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
export const siteDomain = (site) => { try { return new URL(site.site_url || window.location.origin).host; } catch { return window.location.host; } };

/**
 * Cut the selected article out of the page and add a branded header:
 * big logo in the centre; small date on the left; small "Page no:N | website" on the right.
 */
export async function buildBrandedClip({ page, selection, edition, site }) {
  const im = await loadImg(mediaUrl(page.images.large?.url || page.images.medium?.url));
  const sx = selection.x * im.naturalWidth; const sy = selection.y * im.naturalHeight;
  const cw = Math.max(1, Math.round(selection.w * im.naturalWidth)); const ch = Math.max(1, Math.round(selection.h * im.naturalHeight));
  // Header: logo across ~70% of the width; a thin row below it with the date (left) and page + website (right)
  const W = Math.max(cw, 720);
  const pad = Math.round(W * 0.02);
  const fs = Math.round(Math.min(24, Math.max(15, W * 0.016)));
  const logoSrc = site.header_logo || site.site_logo;
  let logo = null;
  if (logoSrc) { try { logo = trimImage(await loadImg(mediaUrl(logoSrc))); } catch { /* text instead */ } }
  let lw = W * 0.7; let lh = logo ? lw * (logo.sh / logo.sw) : W * 0.09;
  const maxLh = W * 0.26;
  if (lh > maxLh) { lw *= maxLh / lh; lh = maxLh; }
  const H = Math.round(pad + lh + pad * 0.6 + fs + pad * 0.8);
  const c = document.createElement('canvas');
  c.width = W; c.height = H + ch;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H + ch);
  if (logo) g.drawImage(logo.img, logo.sx, logo.sy, logo.sw, logo.sh, (W - lw) / 2, pad, lw, lh);
  else {
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ep-primary').trim() || '#c8102e';
    let size = Math.round(lh * 0.9);
    g.font = `900 ${size}px Georgia, "Noto Serif", serif`;
    while (size > 14 && g.measureText(site.site_name || 'ePaper').width > W * 0.7) { size -= 2; g.font = `900 ${size}px Georgia, "Noto Serif", serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(site.site_name || 'ePaper', W / 2, pad + lh / 2);
  }
  // Small date + page/website row
  const rowY = pad + lh + pad * 0.6 + fs / 2;
  g.font = `700 ${fs}px "Noto Sans", Arial, sans-serif`; g.fillStyle = '#111827'; g.textBaseline = 'middle';
  g.textAlign = 'left'; g.fillText(longEditionDate(edition.edition_date), pad, rowY);
  g.textAlign = 'right'; g.fillText(`Page no:${page.position || page.page_number} | ${siteDomain(site)}`, W - pad, rowY);
  // Divider + article
  g.fillStyle = '#d1d5db'; g.fillRect(0, H - 2, W, 2);
  g.drawImage(im, sx, sy, cw, ch, Math.round((W - cw) / 2), H, cw, ch);
  return c.toDataURL('image/jpeg', 0.92);
}

/** Readable article viewer: fit-to-width by default, zoom buttons, Ctrl+wheel, double-click, drag to pan. */
function ZoomableImage({ src, alt }) {
  const wrap = useRef(null);
  const img = useRef(null);
  const drag = useRef(null);
  const [z, setZ] = useState(1); // 1 = fit width
  const [natural, setNatural] = useState(0);
  const MIN = 0.5; const MAX = 5;

  const zoomTo = (next, cx, cy) => {
    const el = wrap.current;
    if (!el) return;
    const nz = Math.min(MAX, Math.max(MIN, next));
    const r = el.getBoundingClientRect();
    const px = cx ?? r.width / 2; const py = cy ?? r.height / 2;
    const fx = (el.scrollLeft + px) / (el.scrollWidth || 1);
    const fy = (el.scrollTop + py) / (el.scrollHeight || 1);
    setZ(nz);
    requestAnimationFrame(() => { el.scrollLeft = fx * el.scrollWidth - px; el.scrollTop = fy * el.scrollHeight - py; });
  };
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth - 2)); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const actual = () => { if (boxW && natural) zoomTo(natural / boxW); };
  // Show the real size relative to the original image (100% = actual pixels)
  const shownPct = natural && boxW ? Math.round((z * boxW / natural) * 100) : Math.round(z * 100);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey) return; // plain wheel scrolls
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(z * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, sl: wrap.current.scrollLeft, st: wrap.current.scrollTop };
    wrap.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    wrap.current.scrollLeft = d.sl - (e.clientX - d.x);
    wrap.current.scrollTop = d.st - (e.clientY - d.y);
  };
  const onUp = () => { drag.current = null; };

  return (
    <div className="az">
      <div className="az-bar">
        <button type="button" className="btn btn-sm btn-light" onClick={() => zoomTo(z / 1.25)} disabled={z <= MIN} aria-label="Zoom out"><i className="bi bi-zoom-out" /></button>
        <span className="az-level">{shownPct}%</span>
        <button type="button" className="btn btn-sm btn-light" onClick={() => zoomTo(z * 1.25)} disabled={z >= MAX} aria-label="Zoom in"><i className="bi bi-zoom-in" /></button>
        <button type="button" className={`btn btn-sm ${z === 1 ? 'btn-dark' : 'btn-light'}`} onClick={() => zoomTo(1)}>Fit width</button>
        {natural > 0 && <button type="button" className="btn btn-sm btn-light" onClick={actual} title="Show at original size">Actual size</button>}
        <span className="az-hint d-none d-md-inline">Ctrl + scroll or double-click to zoom · drag to move</span>
      </div>
      <div ref={wrap} className={`az-wrap ${z > 1 ? 'zoomed' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDoubleClick={(e) => { const r = wrap.current.getBoundingClientRect(); zoomTo(z > 1.4 ? 1 : 2.2, e.clientX - r.left, e.clientY - r.top); }}>
        <img ref={img} src={src} alt={alt} draggable={false} style={{ width: `${z * 100}%` }} onLoad={(e) => setNatural(e.currentTarget.naturalWidth)} />
      </div>
    </div>
  );
}

export function CropPreviewModal({ show, onClose, page, selection, edition, title, description, area }) {
  const { t, site } = useSettings();
  const withComments = !!area && !!site.comments_enabled && !!edition?.comments_enabled;
  const isWide = useMediaQuery('(min-width: 992px)');
  const [showComments, setShowComments] = useState(true);
  const [commentCount, setCommentCount] = useState(null);
  const [preview, setPreview] = useState(null);
  const [clip, setClip] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show || !page || !selection) return;
    let alive = true;
    setClip(null); setPreview(null);
    buildBrandedClip({ page, selection, edition, site })
      .then((url) => alive && setPreview(url))
      .catch(() => alive && setPreview('error'));
    return () => { alive = false; };
  }, [show, page, selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const createClip = async () => {
    if (clip) return clip;
    setBusy(true);
    try {
      const res = await post('/clippings', { page_id: page.id, ...selection });
      setClip(res.data);
      return res.data;
    } catch (e) { toast.error(e.message); return null; } finally { setBusy(false); }
  };

  const downloadClip = async () => {
    if (preview && preview !== 'error') {
      const a = Object.assign(document.createElement('a'), { href: preview, download: `${edition.slug}-p${page.page_number}-clip.jpg` });
      document.body.appendChild(a); a.click(); a.remove();
    } else {
      const c = await createClip();
      if (c) window.open(mediaUrl(`/api/v1/clippings/${c.code}/download`), '_blank');
    }
  };

  return (
    <Modal show={show} onClose={onClose} title={title ? <><i className="bi bi-newspaper me-2" />{title}</> : <><i className="bi bi-scissors me-2" />{t('crop')}</>} size="xl" fullscreenSm>
      <div className={withComments && showComments ? 'ac-layout' : ''}>
        {withComments && showComments && <Comments variant="panel" edition={edition} page={page} area={area} onCount={setCommentCount} onClose={isWide ? () => setShowComments(false) : undefined} />}
        <div className="ac-main">
          {withComments && !showComments && (
            <button type="button" className="btn ac-open mb-2" onClick={() => setShowComments(true)}>
              <i className="bi bi-chat-dots me-1" />{t('comments')}{commentCount ? <span className="ac-count">{commentCount}</span> : null}
            </button>
          )}
          {description && <p className="text-muted small">{description}</p>}
          {preview && preview !== 'error' ? <div className="mb-3"><ZoomableImage src={preview} alt={title || 'Cropped article'} /></div> : (
            <div className="crop-preview mb-3">
              {!preview && <div className="spinner-border text-primary" />}
              {preview === 'error' && <p className="text-muted">Preview unavailable — you can still share the clipping.</p>}
            </div>
          )}
          {!clip ? (
            <div className="d-flex flex-wrap gap-2 justify-content-center">
              <button className="btn btn-primary" onClick={createClip} disabled={busy}>
                {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-share me-2" />}{t('share')}
              </button>
              <button className="btn btn-outline-secondary" onClick={downloadClip}><i className="bi bi-download me-2" />{t('download')}</button>
            </div>
          ) : (
            <>
              <div className="input-group mb-3">
                <input className="form-control" readOnly value={clip.share_url} onFocus={(e) => e.target.select()} />
                <button className="btn btn-primary" onClick={async () => { if (await copyText(clip.share_url)) toast.success(t('copied')); }}><i className="bi bi-clipboard me-1" />{t('copyLink')}</button>
              </div>
              <ShareButtons url={clip.share_url} text={`${edition.title} – ${edition.edition_date} – ${t('page')} ${page.page_number}`} image={mediaUrl(clip.image_url)} />
              <div className="text-center mt-3">
                <button className="btn btn-link btn-sm" onClick={downloadClip}><i className="bi bi-download me-1" />{t('download')}</button>
                <a className="btn btn-link btn-sm" href={appHref(`/clip/${clip.code}`)} target="_blank" rel="noreferrer"><i className="bi bi-box-arrow-up-right me-1" />Open clipping</a>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
