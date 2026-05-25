const https = require('https');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

function httpsGet(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const data = await getNowPlaying();
  res.end(JSON.stringify(data));
};
