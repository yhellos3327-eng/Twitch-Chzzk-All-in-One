const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

// CORS 헤더
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Client-ID',
};

// Twitch 관련 도메인만 허용
const ALLOWED_HOSTS = [
  'usher.ttvnw.net',
  'video-weaver.',
  '.hls.ttvnw.net',
  '.ttvnw.net',
  'api.twitch.tv',
  'gql.twitch.tv',
];

// Twitch Client ID (공개된 웹 클라이언트 ID)
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

function isAllowedUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return ALLOWED_HOSTS.some(host => parsed.hostname.includes(host.replace('.', '')));
  } catch {
    return false;
  }
}

async function fetchWithRedirects(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...options.headers,
      },
    };

    const req = protocol.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchWithRedirects(res.headers.location, options)
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
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Twitch 액세스 토큰 획득 (GQL API)
async function getStreamToken(channel) {
  const playerTypes = ['site', 'embed', 'popout', 'frontpage'];
  let lastError = null;
  let data = null;

  for (const playerType of playerTypes) {
    try {
      console.log(`[Token] Trying playerType: ${playerType}`);

      const body = {
        operationName: 'PlaybackAccessToken',
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: '0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712'
          }
        },
        variables: {
          isLive: true,
          login: channel,
          isVod: false,
          vodID: '',
          playerType: playerType
        }
      };

      let response = await fetchWithRedirects('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Content-Type': 'application/json',
          'Device-ID': 'twitch-web-wall-mason',
        },
        body: JSON.stringify(body),
      });

      data = JSON.parse(response.body.toString());

      // Persisted Query 실패 시 Full Query 시도
      if (data.errors && data.errors[0]?.message?.includes('PersistedQueryNotFound')) {
        console.log(`[Token] Persisted query failed for ${playerType}, trying full query`);

        const fullQuery = {
          operationName: 'PlaybackAccessToken_Template',
          query: `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {
            streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {
              value
              signature
              authorization {
                forbidden
                reason
              }
              __typename
            }
          }`,
          variables: {
            isLive: true,
            login: channel,
            isVod: false,
            vodID: '',
            playerType: playerType
          }
        };

        response = await fetchWithRedirects('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: {
            'Client-ID': TWITCH_CLIENT_ID,
            'Content-Type': 'application/json',
            'Device-ID': 'twitch-web-wall-mason',
          },
          body: JSON.stringify(fullQuery),
        });

        data = JSON.parse(response.body.toString());
      }

      // 토큰 확인
      if (data.data?.streamPlaybackAccessToken?.value) {
        console.log(`[Token] Success with playerType: ${playerType}`);
        return data; // 성공
      } else {
        // 상세 에러 로깅
        if (data.data?.streamPlaybackAccessToken?.authorization) {
          console.log(`[Token] Authorization failed for ${playerType}:`, data.data.streamPlaybackAccessToken.authorization);
        } else {
          console.log(`[Token] No token in response for ${playerType}:`, JSON.stringify(data));
        }
      }

    } catch (e) {
      console.error(`[Token] Error with ${playerType}:`, e.message);
      lastError = e;
    }
  }

  return data || { error: 'Failed to get token', details: lastError };
}

// m3u8 playlist 획득
async function getPlaylist(channel, token, sig) {
  const params = new URLSearchParams({
    allow_source: 'true',
    allow_audio_only: 'true',
    allow_spectre: 'true',
    p: Math.floor(Math.random() * 999999),
    player: 'twitchweb',
    playlist_include_framerate: 'true',
    segment_preference: '4',
    sig: sig,
    token: token,
  });

  const playlistUrl = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${params.toString()}`;

  const response = await fetchWithRedirects(playlistUrl, {
    headers: {
      'Accept': 'application/vnd.apple.mpegurl',
    },
  });

  return {
    status: response.status,
    body: response.body.toString(),
  };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  console.log(`[Request] ${req.method} ${pathname}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // 1. API - Stream Info
  if (pathname.startsWith('/stream/')) {
    const channel = pathname.split('/stream/')[1]?.split('/')[0];

    if (!channel) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing channel name' }));
      return;
    }

    try {
      console.log(`[API] Getting stream for: ${channel}`);
      const tokenData = await getStreamToken(channel);

      console.log(`[API] Token response:`, JSON.stringify(tokenData));

      if (!tokenData.data?.streamPlaybackAccessToken) {
        console.log(`[API] No token found - stream offline or not found`);
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Stream not found or offline' }));
        return;
      }

      const { value: token, signature: sig } = tokenData.data.streamPlaybackAccessToken;
      const playlist = await getPlaylist(channel, token, sig);

      if (playlist.status !== 200) {
        res.writeHead(playlist.status, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to get playlist' }));
        return;
      }

      const lines = playlist.body.split('\n');
      const qualities = [];
      let currentQuality = null;

      for (const line of lines) {
        if (line.startsWith('#EXT-X-MEDIA:')) {
          const nameMatch = line.match(/NAME="([^"]+)"/);
          const groupMatch = line.match(/GROUP-ID="([^"]+)"/);
          if (nameMatch) {
            currentQuality = { name: nameMatch[1], group: groupMatch?.[1] };
          }
        } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
          const fpsMatch = line.match(/FRAME-RATE=([\d.]+)/);
          const bwMatch = line.match(/BANDWIDTH=(\d+)/);
          if (currentQuality) {
            currentQuality.resolution = resMatch?.[1];
            currentQuality.fps = fpsMatch?.[1];
            currentQuality.bandwidth = bwMatch?.[1];
          }
        } else if (line.startsWith('http') && currentQuality) {
          currentQuality.url = line.trim();
          qualities.push(currentQuality);
          currentQuality = null;
        }
      }

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channel, qualities, playlist: playlist.body }));
    } catch (error) {
      console.error(`[API Error]`, error.message);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 2. API - Proxy
  if (pathname.startsWith('/proxy')) {
    const targetUrl = parsedUrl.query.url;
    if (!targetUrl || !isAllowedUrl(targetUrl)) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
      return;
    }

    try {
      const response = await fetchWithRedirects(targetUrl);
      res.writeHead(response.status, { ...corsHeaders, 'Content-Type': response.headers['content-type'] });
      res.end(response.body);
    } catch (error) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 3. Static Files
  if (pathname === '/health') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  let filePath = (pathname === '/' || pathname === '/player') ? '/player.html' : pathname;
  const fullPath = path.join(PUBLIC_DIR, filePath);
  const ext = path.extname(fullPath);
  const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  if (MIME_TYPES[ext] && fs.existsSync(fullPath)) {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': MIME_TYPES[ext] });
    res.end(fs.readFileSync(fullPath));
    return;
  }

  // 4. Fallback 404
  res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`[Twitch Proxy] Server running on port ${PORT}`);
});
