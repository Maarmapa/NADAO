// NADAO /api/chat — puente OpenRouter con fallback a Anthropic (patrón Boykot).
// El HTML habla formato Anthropic; acá se traduce ida y vuelta.
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
  } catch (e) { res.status(500).json({ error: e.message }); }
};
