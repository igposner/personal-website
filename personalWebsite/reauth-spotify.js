// Run: node reauth-spotify.js
// Step 1: it prints a URL — open it in your browser, approve, copy the "code" from the redirect URL
// Step 2: paste the code back here when prompted, and it prints your new SPOTIFY_REFRESH_TOKEN

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const env = {};
fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(line => {
  const [key, ...val] = line.split('=');
  if (key && val.length) env[key.trim()] = val.join('=').trim();
});

const CLIENT_ID = env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'http://127.0.0.1:3000/callback';

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-read-recently-played'
].join(' ');

const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:8888/callback ...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8888');
  if (url.pathname !== '/callback') { res.end('waiting...'); return; }
  console.log('Callback received:', req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error) { res.end(`Spotify error: ${error}`); console.log('Spotify error:', error); server.close(); return; }
  if (!code) { res.end('No code in callback — check terminal.'); console.log('Full URL:', req.url); server.close(); return; }

  res.end('<h2>Got it! Check your terminal for the new SPOTIFY_REFRESH_TOKEN.</h2>');
  server.close();

  const body = `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const tokenReq = https.request({
    hostname: 'accounts.spotify.com',
    path: '/api/token',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, tokenRes => {
    let data = '';
    tokenRes.on('data', c => data += c);
    tokenRes.on('end', () => {
      const json = JSON.parse(data);
      if (json.refresh_token) {
        console.log('\nSuccess! Update your .env file with:\n');
        console.log(`SPOTIFY_REFRESH_TOKEN=${json.refresh_token}\n`);
      } else {
        console.log('Error:', data);
      }
    });
  });
  tokenReq.write(body);
  tokenReq.end();
});

server.listen(3000);
