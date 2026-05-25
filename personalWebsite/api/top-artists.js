const https = require('https');

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USER = 'igposner';

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const data = await getTopArtists();
  res.end(JSON.stringify(data));
};
