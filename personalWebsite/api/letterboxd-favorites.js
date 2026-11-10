const https = require('https');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

function httpsGet(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const location = res.headers.location;
        res.resume();
        const loc = location.startsWith('http') ? new URL(location) : new URL('https://letterboxd.com' + location);
        return httpsGet({ hostname: loc.hostname, path: loc.pathname + loc.search, headers: options.headers }).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

let lbCache = null;
let lbCacheTime = 0;

// Letterboxd blocks server-side scraping (Cloudflare 403), so favorites are listed here.
// Update this list when you change your favorites on letterboxd.com/bigcaasirolle/.
const LB_FAVORITES = [
  { title: 'Dead Poets Society (1989)', slug: 'dead-poets-society' },
  { title: 'Perfect Days (2023)', slug: 'perfect-days-2023' },
  { title: 'Kill Bill: Vol. 1 (2003)', slug: 'kill-bill-vol-1' },
  { title: 'La Haine (1995)', slug: 'la-haine' },
];

async function getLetterboxdFavorites() {
  if (lbCache && Date.now() - lbCacheTime < 10 * 60 * 1000) return lbCache;
  try {
    const slugs = LB_FAVORITES;

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const data = await getLetterboxdFavorites();
  res.end(JSON.stringify(data));
};
