const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body)
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Image endpoint — Grok image-to-image using NADAO real flyers as reference
app.post('/api/image', async (req, res) => {
  try {
    const { prompt, referenceUrl } = req.body;

    // NADAO real flyer references from R2
    const BASE = 'https://okfscrew-media.mario-25d.workers.dev';
    const refs = {
      club:   BASE + '/flyer/1.png',
      urban:  BASE + '/flyer/2.png', 
      street: BASE + '/flyer/3.png',
      logo:   BASE + '/logo/1.png',
      pega1:  BASE + '/pega/1.png',
      pega2:  BASE + '/pega/2.png',
      pega3:  BASE + '/pega/3.png',
    };

    // Pick reference based on style keywords in prompt
    let imgRef = refs.club;
    const p = prompt.toLowerCase();
    if (p.includes('urban') || p.includes('circuit') || p.includes('colmito')) imgRef = refs.urban;
    else if (p.includes('street') || p.includes('tranki') || p.includes('gothic')) imgRef = refs.street;
    else if (p.includes('logo') || p.includes('brand')) imgRef = refs.logo;
    else if (p.includes('luxury') || p.includes('gold')) imgRef = refs.pega1;
    if (referenceUrl) imgRef = referenceUrl;

    // Use /images/edits with reference image for image-to-image
    const body = {
      model: 'grok-imagine-image',
      prompt: prompt + ' Vertical 9:16 portrait format.',
      image: { url: imgRef, type: 'image_url' },
      n: 1,
      response_format: 'url'
    };

    const r = await fetch('https://api.x.ai/v1/images/edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROK_KEY },
      body: JSON.stringify(body)
    });
    
    const data = await r.json();
    
    // If edits fails, fallback to generations
    if (data.error || !data.data) {
      const r2 = await fetch('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROK_KEY },
        body: JSON.stringify({ model: 'grok-imagine-image', prompt: prompt + ' Vertical 9:16 portrait format.', n: 1, response_format: 'url' })
      });
      res.json(await r2.json());
    } else {
      res.json(data);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.send('NADAO Proxy OK'));
app.listen(process.env.PORT || 3000, () => console.log('OK'));
