import cf from 'cloudfront';

// Login gate (viewer-request). Terraform fills in the KeyValueStore id and the site domain.
// The cookie holds SHA-256(username:password:salt) computed by public/login.js.
const kvs = cf.kvs('__KVS_ID__');
const SITE_HOST = '__SITE_HOST__';
const PUBLIC_PATHS = ['/login.html', '/login.js', '/styles.css', '/favicon.ico'];

async function handler(event) {
  const request = event.request;

  // Only the real domain serves the site; the default *.cloudfront.net name is blocked.
  const host = request.headers.host ? request.headers.host.value : '';
  if (host !== SITE_HOST) {
    return { statusCode: 403, statusDescription: 'Forbidden' };
  }

  if (PUBLIC_PATHS.indexOf(request.uri) !== -1) return request;

  const cookie = request.cookies.saa_auth;
  let expected = '';
  try {
    expected = await kvs.get('auth_hash');
  } catch (err) {
    // No password set yet: nobody gets in.
  }
  if (cookie && expected && cookie.value === expected) return request;

  // The book API answers with a status code instead of a redirect to the login page.
  if (request.uri.indexOf('/api/') === 0) {
    return {
      statusCode: 401,
      statusDescription: 'Unauthorized',
      headers: { 'cache-control': { value: 'no-store' } },
    };
  }

  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      location: { value: cookie ? '/login.html?e=1' : '/login.html' },
      'cache-control': { value: 'no-store' },
    },
  };
}
