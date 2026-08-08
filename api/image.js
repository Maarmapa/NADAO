// NADAO /api/image — Grok image-to-image con fallback a text-to-image.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const { prompt, referenceUrl } = req.body || {};
    const BASE = 'https://okfscrew-media.mario-25d.workers.dev';
    const refs = { club: BASE + '/flyer/1.png', urban: BASE + '/flyer/2.png', street: BASE + '/flyer/3.png', logo: BASE + '/logo/1.png' };
    const p = (prompt || '').toLowerCase();
    let imgRef = refs.club;
    if (p.includes('urban') || p.includes('colmito') || p.includes('postparty') || p.includes('cod1go')) imgRef = refs.urban;
    else if (p.includes('street') || p.includes('tshirt') || p.includes('tranki')) imgRef = refs.street;
    else if (p.includes('logo') || p.includes('brand') || p.includes('pret') || p.includes('krown') || p.includes('playa') || p.includes('cherry') || p.includes('agro') || p.includes('light') || p.includes('renacer') || p.includes('nike') || p.includes('heineken')) imgRef = refs.logo;
    if (referenceUrl) imgRef = referenceUrl;

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
