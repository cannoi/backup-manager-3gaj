const http = require('http');

const PORT = process.env.PORT || 8080;

const req = http.request(`http://127.0.0.1:${PORT}/health`, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (res.statusCode === 200 && json.status === 'ok') {
        console.log('Test PASSED: Health endpoint OK');
        process.exit(0);
      } else {
        console.error('Test FAILED: Invalid health response', data);
        process.exit(1);
      }
    } catch (e) {
      console.error('Test FAILED: Parse error', data);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('Test FAILED: Server not reachable', err.message);
  process.exit(1);
});

req.end();
