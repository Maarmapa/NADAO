// NADAO /api/memories — recuerdos en /tmp. OJO: en Vercel /tmp es EFÍMERO por
// instancia: los recuerdos viven mientras la función esté caliente y se
// pierden en frío. Igual que hoy en Render tras cada reinicio. Si el archivo
// de recuerdos pasa a importar de verdad, moverlo a una base (Supabase).
const fs = require('fs');
const { rateLimit } = require('../lib/rate-limit');
const FILE = '/tmp/nadao_memories.json';

// Solo el POST se limita (5 recuerdos / 15 min por IP): el GET es lectura
// barata. En memoria por instancia: mitiga abuso casual, no un ataque
// distribuido (ver lib/rate-limit.js).
const limitPost = rateLimit({ name: 'memories_post', windowMs: 15 * 60 * 1000, max: 5 });

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return []; } }
function save(m) { try { fs.writeFileSync(FILE, JSON.stringify(m)); } catch (e) {} }
// CORS abierto A PROPÓSITO (mismo motivo que /api/chat): el homenaje también
// se sirve desde IPFS/ENS (nadaone.eth.limo) en otro origen.
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  let memories = load();
  if (req.method === 'GET') { res.json(memories); return; }
  if (req.method === 'POST') {
    if (!limitPost(req, res)) return; // ya respondió 429 con Retry-After
    try {
      const mem = req.body || {};
      if (!mem.nombre || !mem.texto) { res.status(400).json({ error: 'Missing fields' }); return; }
      if (typeof mem.nombre !== 'string' || typeof mem.texto !== 'string' || mem.nombre.length > 120 || mem.texto.length > 2000) {
        res.status(400).json({ error: 'nombre/texto deben ser texto (máx 120 / 2000 caracteres)' }); return;
      }
      mem.fecha = new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
      mem.id = Date.now();
      memories.unshift(mem);
      if (memories.length > 200) memories = memories.slice(0, 200);
      save(memories);
      res.json({ ok: true, memory: mem });
    } catch (e) { res.status(500).json({ error: e.message }); }
    return;
  }
  res.status(405).json({ error: 'method' });
};
