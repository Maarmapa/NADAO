const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// Memories stored in memory + file for persistence
const MEMORIES_FILE = path.join('/tmp', 'nadao_memories.json');

function loadMemories() {
  try {
    if (fs.existsSync(MEMORIES_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    }
  } catch(e) {}
  return [];
}

function saveMemories(mems) {
  try {
    fs.writeFileSync(MEMORIES_FILE, JSON.stringify(mems));
  } catch(e) {}
}

let memories = loadMemories();

// Chat endpoint
//
// Puente OpenRouter (mismo patrón que los chats de Boykot): con
// OPENROUTER_API_KEY en las env, el chat conversa vía OpenRouter traduciendo
// el formato Anthropic <-> OpenAI en ambos sentidos — el HTML no cambia nada.
// NADAO_PROVIDER=anthropic fuerza el camino original; NADAO_MODEL (con "/")
// elige modelo, default deepseek/deepseek-chat. Si OpenRouter falla y hay key
// de Anthropic, se reintenta por ahí con log (nada de catch mudo).
app.post('/api/chat', async (req, res) => {
  try {
    if (process.env.OPENROUTER_API_KEY && process.env.NADAO_PROVIDER !== 'anthropic') {
      try {
        const b = req.body || {};
        const msgs = [];
        const sysText = typeof b.system === 'string' ? b.system
          : Array.isArray(b.system) ? b.system.map(s => (s && s.text) || '').join('\n') : '';
        if (sysText) msgs.push({ role: 'system', content: sysText });
        for (const m of (b.messages || [])) {
          const content = typeof m.content === 'string' ? m.content
            : Array.isArray(m.content) ? m.content.map(c => (c && c.text) || '').join('\n') : '';
          if (m && m.role && content) msgs.push({ role: m.role, content });
        }
        const model = (process.env.NADAO_MODEL || '').includes('/') ? process.env.NADAO_MODEL : 'deepseek/deepseek-chat';
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY },
          body: JSON.stringify({ model, max_tokens: b.max_tokens || 1024, messages: msgs })
        });
        const data = await r.json();
        if (data.error) throw new Error(data.error.message || 'openrouter_error');
        const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        // Respuesta con FORMA Anthropic para que el HTML siga entendiendo.
        res.json({ id: data.id || 'or_bridge', type: 'message', role: 'assistant', model,
                   content: [{ type: 'text', text }], stop_reason: 'end_turn' });
        return;
      } catch (e) {
        console.error('[nadao] openrouter fallo, reintento via anthropic:', e.message);
        if (!process.env.ANTHROPIC_API_KEY) { res.status(502).json({ error: e.message }); return; }
      }
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body)
    });
    res.json(await r.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Image endpoint - Grok image-to-image
app.post('/api/image', async (req, res) => {
  try {
    const { prompt, referenceUrl } = req.body;
    const BASE = 'https://okfscrew-media.mario-25d.workers.dev';
    const refs = {
      club: BASE + '/flyer/1.png',
      urban: BASE + '/flyer/2.png',
      street: BASE + '/flyer/3.png',
      logo: BASE + '/logo/1.png',
    };
    const p = (prompt || '').toLowerCase();
    let imgRef = refs.club;
    if (p.includes('urban') || p.includes('colmito') || p.includes('postparty') || p.includes('cod1go')) imgRef = refs.urban;
    else if (p.includes('street') || p.includes('tshirt') || p.includes('tranki')) imgRef = refs.street;
    else if (p.includes('logo') || p.includes('brand') || p.includes('pret') || p.includes('krown') || p.includes('playa') || p.includes('cherry') || p.includes('agro') || p.includes('light') || p.includes('renacer') || p.includes('nike') || p.includes('heineken')) imgRef = refs.logo;
    if (referenceUrl) imgRef = referenceUrl;

    // Try image editing first
    const editBody = {
      model: 'grok-imagine-image',
      prompt: prompt + ' Vertical 9:16 portrait Instagram format.',
      image: { url: imgRef, type: 'image_url' },
      n: 1,
      response_format: 'url'
    };
    const r = await fetch('https://api.x.ai/v1/images/edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROK_KEY },
      body: JSON.stringify(editBody)
    });
    const data = await r.json();
    if (!data.error && data.data) { res.json(data); return; }

    // Fallback to text-to-image
    const r2 = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROK_KEY },
      body: JSON.stringify({ model: 'grok-imagine-image', prompt: prompt + ' Vertical 9:16 portrait format.', n: 1, response_format: 'url' })
    });
    res.json(await r2.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Memories endpoints
app.get('/api/memories', (req, res) => {
  res.json(memories);
});

app.post('/api/memories', (req, res) => {
  try {
    const mem = req.body;
    if (!mem.nombre || !mem.texto) { res.status(400).json({ error: 'Missing fields' }); return; }
    mem.fecha = new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
    mem.id = Date.now();
    memories.unshift(mem);
    if (memories.length > 200) memories = memories.slice(0, 200);
    saveMemories(memories);
    res.json({ ok: true, memory: mem });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.send('NADAO Proxy OK'));
app.listen(process.env.PORT || 3000, () => console.log('OK'));
