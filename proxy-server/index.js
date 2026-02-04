const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 8080;

// CORS 헤더
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Twitch 관련 도메인만 허용
const ALLOWED_HOSTS = [
  'usher.ttvnw.net',
  'video-weaver.',
  '.hls.ttvnw.net',
  '.ttvnw.net',
  'api.twitch.tv',
];

function isAllowedUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return ALLOWED_HOSTS.some(host => parsed.hostname.includes(host.replace('.', '')));
  } catch {
    return false;
  }
}

async function fetchWithRedirects(targetUrl, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        ...headers,
      },
    };

    const req = protocol.request(options, (res) => {
      // 리다이렉트 처리
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchWithRedirects(res.headers.location, headers)
          .then(resolve)
          .catch(reject);
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'twitch-proxy' }));
    return;
  }

  // 프록시 요청
  if (req.url.startsWith('/proxy')) {
    const parsed = url.parse(req.url, true);
    const targetUrl = parsed.query.url;

    if (!targetUrl) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    if (!isAllowedUrl(targetUrl)) {
      res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'URL not allowed' }));
      return;
    }

    try {
      console.log(`[Proxy] Fetching: ${targetUrl}`);

      const response = await fetchWithRedirects(targetUrl, {
        'user-agent': req.headers['user-agent'],
        'accept': req.headers['accept'],
      });

      // playlist 내 상대 URL을 절대 URL로 변환 (필요시)
      let body = response.body;
      const contentType = response.headers['content-type'] || '';

      if (contentType.includes('application/vnd.apple.mpegurl') ||
          targetUrl.includes('.m3u8')) {
        // m3u8 파일 그대로 전달
        res.writeHead(response.status, {
          ...corsHeaders,
          'Content-Type': 'application/vnd.apple.mpegurl',
        });
      } else {
        res.writeHead(response.status, {
          ...corsHeaders,
          'Content-Type': contentType,
        });
      }

      res.end(body);
      console.log(`[Proxy] Success: ${response.status}`);

    } catch (error) {
      console.error(`[Proxy] Error:`, error.message);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[Twitch Proxy] Server running on port ${PORT}`);
});
