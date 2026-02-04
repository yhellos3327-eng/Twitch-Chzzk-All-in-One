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
  // persistedQuery 방식 시도
  const persistedQuery = {
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
      playerType: 'embed'
    }
  };

  let response = await fetchWithRedirects('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(persistedQuery),
  });

  let data = JSON.parse(response.body.toString());
  console.log('[Token] Persisted query response:', JSON.stringify(data).substring(0, 300));

  // persistedQuery가 실패하면 일반 쿼리로 재시도
  if (!data.data?.streamPlaybackAccessToken) {
    console.log('[Token] Persisted query failed, trying full query');

    const fullQuery = {
      operationName: 'PlaybackAccessToken_Template',
      query: `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {
        streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {
          value
          signature
          __typename
        }
        videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {
          value
          signature
          __typename
        }
      }`,
      variables: {
        isLive: true,
        login: channel,
        isVod: false,
        vodID: '',
        playerType: 'embed'
      }
    };

    response = await fetchWithRedirects('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fullQuery),
    });

    data = JSON.parse(response.body.toString());
    console.log('[Token] Full query response:', JSON.stringify(data).substring(0, 300));
  }

  return data;
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
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'twitch-proxy' }));
    return;
  }

  // API 경로는 정적 파일로 처리하지 않음
  const isApiRoute = req.url.startsWith('/stream/') || req.url.startsWith('/proxy');

  // 정적 파일 서빙 (player 페이지) - API 경로가 아닌 경우만
  if (!isApiRoute) {
    const MIME_TYPES = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };

    // 루트 또는 /player로 접근 시 player.html 제공
    const parsedUrl = url.parse(req.url, true);
    let filePath = parsedUrl.pathname;

    if (filePath === '/' || filePath === '/player' || filePath === '/player.html') {
      filePath = '/player.html';
    }

    // 정적 파일 체크
    const fullPath = path.join(PUBLIC_DIR, filePath);
    const ext = path.extname(fullPath);

    if (MIME_TYPES[ext] && fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath);
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Type': MIME_TYPES[ext],
          'Cache-Control': 'no-cache'
        });
        res.end(content);
        return;
      } catch (e) {
        console.error('[Static] Error reading file:', e.message);
      }
    }
  }

  // 스트림 정보 API (토큰 + playlist 한번에)
  if (req.url.startsWith('/stream/')) {
    const channel = req.url.split('/stream/')[1]?.split('?')[0];

    if (!channel) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing channel name' }));
      return;
    }

    try {
      console.log(`[Stream] Getting stream for: ${channel}`);

      // 1. 토큰 획득
      const tokenData = await getStreamToken(channel);

      if (!tokenData.data?.streamPlaybackAccessToken) {
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Stream not found or offline' }));
        return;
      }

      const { value: token, signature: sig } = tokenData.data.streamPlaybackAccessToken;

      // 2. playlist 획득
      const playlist = await getPlaylist(channel, token, sig);

      if (playlist.status !== 200) {
        res.writeHead(playlist.status, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to get playlist' }));
        return;
      }

      // 3. playlist 파싱해서 화질 목록 추출
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
      res.end(JSON.stringify({
        channel,
        qualities,
        playlist: playlist.body,
      }));

      console.log(`[Stream] Success: ${channel}, ${qualities.length} qualities`);

    } catch (error) {
      console.error(`[Stream] Error:`, error.message);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 일반 프록시 요청
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
        headers: {
          'user-agent': req.headers['user-agent'],
          'accept': req.headers['accept'],
        },
      });

      let body = response.body;
      const contentType = response.headers['content-type'] || '';

      if (contentType.includes('application/vnd.apple.mpegurl') || targetUrl.includes('.m3u8')) {
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
