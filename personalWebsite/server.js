const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
const env = {};
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) env[key.trim()] = val.join('=').trim();
  });
} catch (e) {}

const CLIENT_ID = env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = env.SPOTIFY_REFRESH_TOKEN;
const TMDB_API_KEY = env.TMDB_API_KEY;
const LASTFM_API_KEY = env.LASTFM_API_KEY;
const LASTFM_USER = 'igposner';

function httpsGet(options, resolveUrl = false) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const location = res.headers.location;
        res.resume();
        const loc = location.startsWith('http') ? new URL(location) : new URL('https://letterboxd.com' + location);
        if (resolveUrl) {
          return httpsGet({ hostname: loc.hostname, path: loc.pathname + loc.search, headers: options.headers }, true)
            .then(resolve).catch(() => resolve(loc.href));
        }
        return httpsGet({ hostname: loc.hostname, path: loc.pathname + loc.search, headers: options.headers }).then(resolve).catch(reject);
      }
      if (resolveUrl) {
        res.resume();
        return resolve(`https://${options.hostname}${options.path}`);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, method: 'POST' }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}`;
  const res = await httpsPost({
    hostname: 'accounts.spotify.com',
    path: '/api/token',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  return JSON.parse(res.body).access_token;
}

let npCache = null;
let npCacheTime = 0;

async function getNowPlaying() {
  if (npCache && Date.now() - npCacheTime < 30 * 1000) return npCache;
  try {
    const token = await getAccessToken();
    const res = await httpsGet({
      hostname: 'api.spotify.com',
      path: '/v1/me/player/currently-playing',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 200 && res.body) {
      const json = JSON.parse(res.body);
      if (json.item) {
        npCache = {
          playing: json.is_playing,
          title: json.item.name,
          artist: json.item.artists.map(a => a.name).join(', '),
          albumArt: json.item.album.images[0]?.url || null,
          songUrl: json.item.external_urls.spotify
        };
        npCacheTime = Date.now();
        return npCache;
      }
    }
    // Not currently playing — fetch most recent track
    const recentRes = await httpsGet({
      hostname: 'api.spotify.com',
      path: '/v1/me/player/recently-played?limit=1',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (recentRes.status === 200 && recentRes.body) {
      const recentJson = JSON.parse(recentRes.body);
      const track = recentJson.items?.[0]?.track;
      if (track) {
        npCache = {
          playing: false,
          lastPlayed: true,
          title: track.name,
          artist: track.artists.map(a => a.name).join(', '),
          albumArt: track.album.images[0]?.url || null,
          songUrl: track.external_urls.spotify
        };
        npCacheTime = Date.now();
        return npCache;
      }
    }
    return npCache || { playing: false };
  } catch (e) {
    return npCache || { playing: false };
  }
}

async function getTopArtists() {
  try {
    const res = await httpsGet({
      hostname: 'ws.audioscrobbler.com',
      path: `/2.0/?method=user.gettopartists&user=${LASTFM_USER}&period=7day&limit=5&api_key=${LASTFM_API_KEY}&format=json`,
      headers: { 'Accept': 'application/json' }
    });
    if (res.status !== 200 || !res.body) return [];
    const data = JSON.parse(res.body);
    return (data.topartists?.artist || []).map(a => ({
      name: a.name,
      plays: parseInt(a.playcount, 10)
    }));
  } catch (e) {
    return [];
  }
}

// Letterboxd cache
let lbCache = null;
let lbCacheTime = 0;


async function getLetterboxdFavorites() {
  if (lbCache && Date.now() - lbCacheTime < 10 * 60 * 1000) return lbCache;
  try {
    const res = await httpsGet({
      hostname: 'letterboxd.com',
      path: '/bigcaasirolle/',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html'
      }
    });

    const html = res.body;
    const favStart = html.indexOf('section id="favourites"');
    const favEnd = html.indexOf('</section>', favStart);
    const section = html.slice(favStart, favEnd);

    const slugs = [];
    const re = /data-item-name="([^"]+)"[^>]*data-item-slug="([^"]+)"/g;
    let match;
    while ((match = re.exec(section)) !== null && slugs.length < 4) {
      slugs.push({ title: match[1], slug: match[2] });
    }

    const favorites = await Promise.all(slugs.map(async ({ title, slug }) => {
      const titleOnly = title.replace(/\s*\(\d{4}\)$/, '');
      const yearMatch = title.match(/\((\d{4})\)$/);
      const year = yearMatch ? yearMatch[1] : '';
      let poster = null;
      try {
        const query = encodeURIComponent(titleOnly);
        const tmdbRes = await httpsGet({
          hostname: 'api.themoviedb.org',
          path: `/3/search/movie?query=${query}${year ? `&year=${year}` : ''}&api_key=${TMDB_API_KEY}`,
          headers: { 'Accept': 'application/json' }
        });
        const data = JSON.parse(tmdbRes.body);
        const posterPath = data.results?.[0]?.poster_path;
        if (posterPath) poster = `https://image.tmdb.org/t/p/w185${posterPath}`;
      } catch (e) {}
      return { title, slug, poster, url: `https://letterboxd.com/film/${slug}/` };
    }));

    lbCache = favorites;
    lbCacheTime = Date.now();
    return favorites;
  } catch (e) {
    return lbCache || [];
  }
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/now-playing') {
    return json(res, await getNowPlaying());
  }
  if (req.url === '/api/top-artists') {
    return json(res, await getTopArtists());
  }
  if (req.url === '/api/letterboxd-favorites') {
    return json(res, await getLetterboxdFavorites());
  }

  const cleanUrl = req.url.split('?')[0];
  if (/\.(jpe?g|png|gif|webp)$/i.test(cleanUrl)) {
    const filePath = path.join(__dirname, cleanUrl);
    if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(data);
    });
    return;
  }

  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(3000, () => console.log('Server running at http://localhost:3000'));
