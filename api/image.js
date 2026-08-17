// NADAO /api/image — Grok image-to-image con fallback a text-to-image.
const { rateLimit } = require('../lib/rate-limit');

// 5 imágenes / 15 min por IP (cada llamada puede ser 2 generaciones en x.ai:
// edit + fallback). En memoria por instancia: mitiga abuso casual, no un
// ataque distribuido (ver lib/rate-limit.js).
const limit = rateLimit({ name: 'image', windowMs: 15 * 60 * 1000, max: 5 });

// referenceUrl se reenvía a x.ai tal cual, así que antes aceptaba cualquier
// URL (http interno, hosts ajenos...) = SSRF por proxy. Hoy ningún HTML del
// repo ni la copia IPFS mandan referenceUrl; se mantiene el parámetro para
// el muro de imágenes viejo pero SOLO https y SOLO hosts conocidos.
const BASE = 'https://okfscrew-media.mario-25d.workers.dev';
const REF_HOSTS_EXACT = new Set(['okfscrew-media.mario-25d.workers.dev', 'i.imgur.com']);
const REF_HOSTS_SUFFIX = ['.vercel.app'];

function allowedReference(u) {
  if (typeof u !== 'string' || u.length > 2048) return false;
  let url;
  try { url = new URL(u); } catch (e) { return false; }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (REF_HOSTS_EXACT.has(host)) return true;
  return REF_HOSTS_SUFFIX.some(suf => host.endsWith(suf) && host.length > suf.length);
}

// CORS abierto A PROPÓSITO (mismo motivo que /api/chat): el homenaje también
// se sirve desde IPFS/ENS (nadaone.eth.limo) en otro origen. La protección
// contra el gasto es el rate limit, no el CORS.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!limit(req, res)) return; // ya respondió 429 con Retry-After
  try {
    const { prompt, referenceUrl } = req.body || {};
    if (typeof prompt !== 'string' || !prompt.trim()) { res.status(400).json({ error: 'prompt requerido' }); return; }
    if (prompt.length > 4000) { res.status(400).json({ error: 'prompt demasiado largo' }); return; }
    if (referenceUrl !== undefined && referenceUrl !== null && referenceUrl !== '' && !allowedReference(referenceUrl)) {
      res.status(400).json({ error: 'referenceUrl no permitido: solo https en hosts conocidos' });
      return;
    }
    const refs = { club: BASE + '/flyer/1.png', urban: BASE + '/flyer/2.png', street: BASE + '/flyer/3.png', logo: BASE + '/logo/1.png' };
    const p = prompt.toLowerCase();
    let imgRef = refs.club;
    if (p.includes('urban') || p.includes('colmito') || p.includes('postparty') || p.includes('cod1go')) imgRef = refs.urban;
    else if (p.includes('street') || p.includes('tshirt') || p.includes('tranki')) imgRef = refs.street;
    else if (p.includes('logo') || p.includes('brand') || p.includes('pret') || p.includes('krown') || p.includes('playa') || p.includes('cherry') || p.includes('agro') || p.includes('light') || p.includes('renacer') || p.includes('nike') || p.includes('heineken')) imgRef = refs.logo;
    if (referenceUrl && allowedReference(referenceUrl)) imgRef = referenceUrl;

    const r = await fetch('https://api.x.ai/v1/images/edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROK_KEY },
      body: JSON.stringify({ model: 'grok-imagine-image', prompt: prompt + ' Vertical 9:16 portrait Instagram format.', image: { url: imgRef, type: 'image_url' }, n: 1, response_format: 'url' })
    });
    const data = await r.json();
    if (!data.error && data.data) { res.json(data); return; }

    const r2 = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROK_KEY },
      body: JSON.stringify({ model: 'grok-imagine-image', prompt: prompt + ' Vertical 9:16 portrait format.', n: 1, response_format: 'url' })
    });
    res.json(await r2.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
};
