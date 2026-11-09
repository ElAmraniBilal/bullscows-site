(() => {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  window.BULLS_COWS_API_BASE = isLocal ? '' : 'https://api.bullscows.xyz';
})();
