/* Sign-in: stores SHA-256(username:password:SALT) in a cookie.
   The CloudFront function (infras/auth-function.js) compares it with the hash in the KeyValueStore;
   infras/scripts/set-password.sh writes that hash with the same formula. */
(() => {
  'use strict';
  const SALT = 'saa-quannh-xyz-v1';
  const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('formError');
  const showError = msg => { errorBox.textContent = msg; errorBox.hidden = !msg; };

  // The CloudFront function sends people back here with ?e=1 when their cookie does not match
  if (new URLSearchParams(location.search).get('e') === '1') {
    showError('Wrong username or password, or your session has expired. Please sign in again.');
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) return showError('Enter both your username and password.');
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    const hash = await sha256Hex(`${username}:${password}:${SALT}`);
    const attrs = `Path=/; Max-Age=${MAX_AGE}; Secure; SameSite=Lax`;
    document.cookie = `saa_auth=${hash}; ${attrs}`;
    document.cookie = `saa_user=${encodeURIComponent(username)}; ${attrs}`;
    location.replace('/');
  });

  document.getElementById('username').focus();
})();
