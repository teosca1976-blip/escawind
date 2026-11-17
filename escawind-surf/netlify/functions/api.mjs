import { loadLocs, saveLocs, loadRes, runAll } from './lib.mjs';
const handler = async (req) => {
  const code = process.env.ACCESS_CODE;
  if (!code) return Response.json({ error: 'ACCESS_CODE non impostato' }, { status: 500 });
  if (req.headers.get('x-code') !== code) return Response.json({ error: 'codice errato' }, { status: 401 });
  const p = new URL(req.url).pathname.replace(/^\/api\//, '');
  if (p === 'data') return Response.json({ locations: await loadLocs(), results: await loadRes() });
  if (p === 'locations' && req.method === 'POST') {
    const l = await req.json();
    if (!Array.isArray(l)) return Response.json({ error: 'formato non valido' }, { status: 400 });
    await saveLocs(l); return Response.json({ ok: 1 });
  }
  if (p === 'run' && req.method === 'POST') { await runAll(); return Response.json({ ok: 1 }); }
  if (p === 'test' && req.method === 'POST') { await runAll({ test: true }); return Response.json({ ok: 1 }); }
  return Response.json({ error: 'non trovato' }, { status: 404 });
};
export default async (req) => {
  try { return await handler(req); }
  catch (e) { console.error(e); return Response.json({ error: String(e.message || e) }, { status: 500 }); }
};
export const config = { path: '/api/*' };
