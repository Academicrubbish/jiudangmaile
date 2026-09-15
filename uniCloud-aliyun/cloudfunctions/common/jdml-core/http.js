'use strict';
const https = require('https');
function postJSON(url, body, { headers = {}, timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body));
    let ended = false;
    const finish = (error, value) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const request = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bytes.length,
          ...headers
        }
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 65536) {
            finish(new Error('RESPONSE_TOO_LARGE'));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300)
            return finish(new Error('HTTP_' + response.statusCode));
          try {
            finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (_) {
            finish(new Error('INVALID_JSON'));
          }
        });
        response.on('error', () => finish(new Error('NETWORK_ERROR')));
      }
    );
    const timer = setTimeout(() => {
      finish(new Error('TIMEOUT'));
      request.destroy();
    }, timeoutMs);
    request.on('error', () => finish(new Error('NETWORK_ERROR')));
    request.end(bytes);
  });
}
module.exports = { postJSON };
