// NADAO — límite de tasa por IP para las funciones de /api (mismo espíritu que
// rateLimit() del server.js de Maarmapa/map, adaptado a funciones Vercel).
//
// Por qué: /api/chat, /api/image y /api/memories no tienen auth. Cualquiera
// con la URL puede llamarlas y cada llamada a chat/image gasta crédito real
// (OpenRouter / Anthropic / x.ai). Sin techo, un script de spam genera costo
// sin límite. Este limitador pone un techo barato por IP.
//
// HONESTIDAD SOBRE EL ALCANCE: en serverless el Map vive en memoria de la
// instancia. Vercel puede levantar varias instancias en paralelo y cada una
// cuenta por su lado, y un arranque en frío parte de cero. Esto mitiga el
// abuso casual (un loop desde una IP, un curl en bucle) pero NO frena un
// ataque distribuido ni garantiza el número exacto. Si eso llega a importar,
// el siguiente paso es un contador compartido (Upstash/Redis o Vercel KV) o
// una regla de rate limit en el Firewall de Vercel.

const buckets = new Map(); // `${name}:${ip}` -> { count, windowStart }
let lastSweep = 0;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
const SWEEP_OLDER_THAN_MS = 60 * 60 * 1000;

// Primer valor de x-forwarded-for (en Vercel lo fija el proxy con la IP del
// cliente), luego x-real-ip, luego el socket. 'unknown' agrupa lo que no se
// pueda identificar en un solo balde: preferible a dejarlo sin límite.
function clientIp(req) {
  const h = req.headers || {};
  const xff = Array.isArray(h['x-forwarded-for']) ? h['x-forwarded-for'][0] : (h['x-forwarded-for'] || '');
  const first = String(xff).split(',')[0].trim();
  if (first) return first;
  const real = Array.isArray(h['x-real-ip']) ? h['x-real-ip'][0] : h['x-real-ip'];
  if (real) return String(real).trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Barrido perezoso: sin setInterval (en serverless el proceso se congela entre
// invocaciones), se limpia cada tanto al pasar una request.
function sweep(now) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  const cutoff = now - SWEEP_OLDER_THAN_MS;
  for (const [key, b] of buckets) if (b.windowStart < cutoff) buckets.delete(key);
}

// rateLimit({ name, windowMs, max }) -> (req, res) => boolean
// Devuelve true si la request puede seguir. Si no, responde 429 JSON con
// Retry-After (segundos) y devuelve false: el handler debe hacer `return`.
function rateLimit({ name, windowMs, max }) {
  if (!name || !windowMs || !max) throw new Error('rateLimit: name, windowMs y max son obligatorios');
  return function check(req, res) {
    const now = Date.now();
    sweep(now);
    const key = `${name}:${clientIp(req)}`;
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - bucket.windowStart)) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'rate_limited', retry_after_seconds: retryAfterSec });
      return false;
    }
    bucket.count++;
    return true;
  };
}

module.exports = { rateLimit, clientIp };
