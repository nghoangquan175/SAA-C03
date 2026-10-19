import cf from 'cloudfront';

// Login gate (viewer-request). Terraform fills in the KeyValueStore id.
// The cookie holds SHA-256(username:password:salt) computed by public/login.js.
const kvs = cf.kvs('__KVS_ID__');
const PUBLIC_PATHS = ['/login.html', '/login.js', '/styles.css', '/favicon.ico'];

async function handler(event) {
  const request = event.request;
  if (PUBLIC_PATHS.indexOf(request.uri) !== -1) return request;

  const cookie = request.cookies.saa_auth;
  let expected = '';
  try {
    expected = await kvs.get('auth_hash');
  } catch (err) {
    // No password set yet: nobody gets in.
  }
  if (cookie && expected && cookie.value === expected) return request;

  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      location: { value: cookie ? '/login.html?e=1' : '/login.html' },
      'cache-control': { value: 'no-store' },
    },
  };
}
