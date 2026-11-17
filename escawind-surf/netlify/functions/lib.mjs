import { getStore } from '@netlify/blobs';
const st = () => getStore('escawind');
const rd = async (k, d) => (await st().get(k, { type: 'json' })) ?? d;
const A = 'meteofrance_arome_france_hd', mk = (name, grp, lat, lon, minKn, dir, rainBlock) => ({ id: crypto.randomUUID(), name, grp, lat, lon, model: A, minKn, dir, rainBlock, on: true, wg: '' });
const DEFAULTS = [mk('Valmadrera', 'Lago di Lecco', 45.836, 9.352, 12, '', false), mk('Pianello', 'Lago di Lecco', 46.1, 9.27, 12, '', false),
  mk('Gera', 'Lago di Lecco', 46.151, 9.385, 12, '', false), mk('Dervio', 'Lago di Lecco', 46.072, 9.312, 12, '', false), mk('Abbadia', 'Lago di Lecco', 45.903, 9.335, 12, '', false),
  mk('Tignale', 'Lago di Garda', 45.73, 10.72, 12, '', false), mk('Riva del Garda', 'Lago di Garda', 45.886, 10.842, 12, '', false),
  mk('Tre Ponti (Livorno)', 'Mare', 43.492, 10.33, 12, '', false), mk('Sottomarina', 'Mare', 45.23, 12.3, 12, '', false),
  mk('Porto Corsini', 'Mare', 44.49, 12.281, 12, '', false), mk('Carteau (Camargue)', 'Mare', 43.395, 4.838, 12, '', false)];
// Spot surf: kind 'surf'. minH = altezza onda minima (m), minP = periodo minimo (s), sdir = direzione di provenienza del mare (gradi, '' = qualsiasi), maxKn = vento massimo (nodi)
const sk = (name, lat, lon, sdir) => ({ id: crypto.randomUUID(), name, grp: 'Surf', kind: 'surf', lat, lon, model: A, minH: 1, minP: 6, sdir, maxKn: 15, on: true, wg: '' });
const SURF = [sk('Andora', 43.95, 8.15, 225), sk('Levanto', 44.168, 9.613, 225), sk('Isola delle Femmine', 38.195, 13.25, 0), sk('Marina di Pietrasanta', 43.955, 10.17, 225)];
export const saveLocs = (l) => st().setJSON('locations', l);
export const loadLocs = async () => {
  let l = (await rd('locations', null)) ?? (await saveLocs(DEFAULTS), DEFAULTS);
  if (!(await rd('surfseed', false))) { // una sola volta: aggiunge gli spot surf alle località già salvate
    if (!l.some((x) => x.kind === 'surf')) { l = [...l, ...SURF]; await saveLocs(l); }
    await st().setJSON('surfseed', true);
  }
  return l;
};
export const loadRes = () => rd('results', {});
// Preferenze email: slots = fasce in cui inviare (m = mattina, p = pomeriggio, s = sera), disc = cosa ricevere (both / wind / surf)
const SLOTS = ['m', 'p', 's'], DISC = ['both', 'wind', 'surf'];
export const loadSettings = async () => ({ slots: [...SLOTS], disc: 'both', ...(await rd('settings', {})) });
export const saveSettings = (s) => st().setJSON('settings', { slots: (Array.isArray(s?.slots) ? s.slots : []).filter((x) => SLOTS.includes(x)), disc: DISC.includes(s?.disc) ? s.disc : 'both' });

const H0 = 6, H1 = 21; // fascia utile: dalle 06:00 alle 20:59 (ultima ora mostrata: 20h). Fuori fascia le ore non vengono né valutate né mostrate
const pick = (h, k, m) => h[k] ?? h[`${k}_${m}`];
const rome = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16).replace(' ', 'T');
const slotNow = () => { const h = +rome().slice(11, 13); return h < 11 ? 'm' : h < 17 ? 'p' : 's'; }; // controlli alle ~08:30, ~14:30, ~20:30
const anyDir = (v) => v == null || v === '';
const C = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], card = (d) => C[Math.round(d / 45) % 8];
const diff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

async function get(url, params) {
  const r = await fetch(`${url}?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return (await r.json()).hourly;
}

// Onde: solo per località non lacustri. Prova più modelli marini finché uno restituisce dati
const WM = ['', 'meteofrance_wave', 'ecmwf_wam025', 'ewam'];
async function waves(base) {
  let err = '';
  for (const m of WM) {
    try {
      const h = await get('https://marine-api.open-meteo.com/v1/marine', { ...base, cell_selection: 'sea', ...(m && { models: m }),
        hourly: 'wave_height,wind_wave_height,swell_wave_height,wave_period,wave_direction,swell_wave_direction' });
      const g = (k) => pick(h, k, m) || [];
      const hs = h.time.map((_, i) => { const a = g('wave_height')[i], b = g('wind_wave_height')[i], c = g('swell_wave_height')[i];
        return a ?? (b != null || c != null ? Math.hypot(b ?? 0, c ?? 0) : null); });
      if (hs.some((v) => v != null)) { const sd = g('swell_wave_direction'), wd = g('wave_direction');
        return { wh: hs, wp: g('wave_period'), wdir: h.time.map((_, i) => sd[i] ?? wd[i] ?? null), model: m || 'best_match' }; }
      err = 'dati nulli';
    } catch (e) { err = String(e.message || e).slice(0, 80); }
  }
  return { wh: null, wp: null, wdir: null, model: null, err };
}

export async function checkLocation(l) {
  let m = l.model || A, fallback = false;
  const base = { latitude: l.lat, longitude: l.lon, timezone: 'Europe/Rome', forecast_days: 6 };
  const fc = (mm) => get('https://api.open-meteo.com/v1/forecast', { ...base, models: mm, wind_speed_unit: 'kn',
    hourly: 'wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation' });
  let h = await fc(m);
  if (!pick(h, 'wind_speed_10m', m)?.some((v) => v != null)) { m = 'icon_seamless'; fallback = true; h = await fc(m); }
  // Orizzonte: i modelli ad alta risoluzione (AROME, ICON-D2...) coprono ~2 giorni: le ore mancanti si completano con ICON
  let extFrom = null;
  const w0 = pick(h, 'wind_speed_10m', m), t0 = rome();
  if (m !== 'icon_seamless' && h.time.some((t, i) => t >= t0 && w0[i] == null)) {
    try {
      const hi = await fc('icon_seamless');
      for (const k of ['wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'precipitation']) {
        const a = pick(h, k, m), b = pick(hi, k, 'icon_seamless');
        if (a && b) a.forEach((v, i) => { if (v == null && b[i] != null) { a[i] = b[i]; if (k === 'wind_speed_10m' && h.time[i] >= t0) extFrom ??= h.time[i]; } });
      }
    } catch {}
  }
  const lake = /lago/i.test(l.grp || ''), wv = lake ? null : await waves(base); // gli spot surf usano sempre i dati marini
  const now = rome();
  const rows = h.time.map((t, i) => {
    const p = wv?.wp?.[i] ?? null, q = wv?.wh?.[i] ?? null, sd = wv?.wdir?.[i] ?? null;
    return { t, w: pick(h, 'wind_speed_10m', m)[i], g: pick(h, 'wind_gusts_10m', m)[i], d: pick(h, 'wind_direction_10m', m)[i],
      r: pick(h, 'precipitation', m)[i], p, wh: q == null ? null : +q.toFixed(1), sd };
  }).filter((x) => x.t >= now && x.w != null && +x.t.slice(11, 13) >= H0 && +x.t.slice(11, 13) < H1).slice(0, 120);
  for (const x of rows) {
    const hr = +x.t.slice(11, 13);
    const day = hr >= H0 && hr < H1;
    if (l.kind === 'surf') { // surf: onda alta e lunga abbastanza, mare dalla direzione giusta, vento non troppo forte
      const dirOk = anyDir(l.sdir) || x.sd == null || diff(x.sd, +l.sdir) <= 45;
      x.ok = day && x.wh != null && x.wh >= (l.minH ?? 1) && x.p != null && x.p >= (l.minP ?? 6) && dirOk && (l.maxKn == null || l.maxKn === '' || x.w <= +l.maxKn);
    } else x.ok = day && x.w >= l.minKn && (!l.dir && l.dir !== 0 || l.dir === '' || diff(x.d, +l.dir) <= 45) && !(l.rainBlock && x.r > 0.1);
  }
  return { rows, h0: H0, h1: H1, alert: rows.some((x) => x.ok), model: m, fallback, extFrom, wave: wv && { model: wv.model, err: wv.err } };
}

async function mail({ wind = [], surf = [] }, { test = false } = {}) {
  const key = process.env.RESEND_API_KEY, to = process.env.ALERT_EMAIL;
  if (!key || !to) { if (test) throw new Error('RESEND_API_KEY o ALERT_EMAIL non impostati su Netlify'); return; }
  const n = wind.length + surf.length;
  if (!n && !test) return;
  const tag = test ? '[TEST] ' : '';
  const sec = (t, a) => (a.length ? `${t}\n${a.join('\n\n')}` : '');
  const body = n ? [sec('VENTO', wind), sec('SURF', surf)].filter(Boolean).join('\n\n') : `Nessuna località con condizioni utili nei prossimi 5 giorni (fascia ${H0}–${H1}).`;
  const what = [wind.length && `vento ${wind.length}`, surf.length && `surf ${surf.length}`].filter(Boolean).join(', ');
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'EscaWind <onboarding@resend.dev>', to: [to], subject: `EscaWind${test ? ' [TEST]' : ''}: ${n ? `alert ${what}` : 'nessun alert'}`, text: `${tag}${body}\n\nDashboard: ${process.env.URL || ''}` }) });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export async function runAll({ notify = false, test = false } = {}) {
  const locs = (await loadLocs()).filter((l) => l.on !== false), res = {};
  await Promise.all(locs.map(async (l) => {
    try { res[l.id] = { at: new Date().toISOString(), ...(await checkLocation(l)) }; }
    catch (e) { res[l.id] = { at: new Date().toISOString(), error: String(e.message || e) }; }
  }));
  await st().setJSON('results', res);
  if (notify || test) {
    const cfg = await loadSettings();
    if (notify && !test && !cfg.slots.includes(slotNow())) return res; // fascia disattivata: nessuna mail e stato degli alert invariato
    const incl = (l) => cfg.disc === 'both' || (cfg.disc === 'surf') === (l.kind === 'surf');
    // in modalità test si ignora lo stato degli alert già inviati e non lo si modifica
    const prev = test ? {} : await rd('alerts', {}), now = {}, items = { wind: [], surf: [] };
    for (const l of locs) {
      if (!incl(l)) { if (prev[l.id]) now[l.id] = prev[l.id]; continue; } // disciplina esclusa: non la segno come già inviata
      const ok = (res[l.id]?.rows || []).filter((x) => x.ok);
      if (!ok.length) continue;
      now[l.id] = ok.map((x) => x.t).join();
      if (prev[l.id] === now[l.id]) continue;
      const mx = (k) => Math.round(Math.max(...ok.map((x) => x[k])) * 10) / 10, when = `${ok[0].t.replace('T', ' ')} – ${ok.at(-1).t.replace('T', ' ')}, ${ok.length} ore utili`;
      if (l.kind === 'surf') {
        const best = ok.reduce((a, x) => (x.wh > a.wh ? x : a));
        items.surf.push(`${l.name}: ${when}, onda fino a ${mx('wh')} m, periodo fino a ${mx('p')} s, mare da ${best.sd == null ? 'n/d' : card(best.sd)}, vento fino a ${mx('w')} nodi`);
      } else items.wind.push(`${l.name} (${l.grp || 'Altre'}): ${when}, vento fino a ${mx('w')} nodi, raffiche fino a ${mx('g')} nodi (${res[l.id].model})`);
    }
    if (test) await mail(items, { test: true });
    else { await st().setJSON('alerts', now); try { await mail(items); } catch (e) { console.error('mail', e); } }
  }
  return res;
}
