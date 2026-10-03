require('dotenv').config();

require('./db');

const express = require('express');
const net = require('node:net');
const path = require('path');
const { generateAI } = require('./ai');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/test-ai', async (req, res) => {
  try {
    const response = await generateAI('Respond with exactly: Study Coach AI connection successful', req.get('x-groq-api-key'));
    res.json({ ok: true, response });
  } catch {
    res.status(500).json({
      ok: false,
      error: 'AI request failed. Check your Groq API key and connection, then try again.'
    });
  }
});

app.use('/api', require('./api'));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.type === 'entity.too.large' ? 413 : 400;
  res.status(status).json({ error: status === 413 ? 'Request body is too large.' : 'Request body must be valid JSON.' });
});

if (require.main === module) {
  function tryNextPort(currentPort, attemptsRemaining) {
    if (attemptsRemaining === 0) {
      console.error('Oryn AI could not find an available port. Set PORT in .env and try again.');
      process.exitCode = 1;
      return;
    }
    const nextPort = currentPort + 1;
    console.warn(`Port ${currentPort} is busy. Trying port ${nextPort}.`);
    startServer(nextPort, attemptsRemaining - 1);
  }

  function listenOnPort(currentPort, attemptsRemaining) {
    const server = app.listen({ port: currentPort, host: '127.0.0.1', exclusive: true }, () => {
      const address = server.address();
      if (!address) return tryNextPort(currentPort, attemptsRemaining);
      console.log(`Oryn AI is running at http://127.0.0.1:${address.port}`);
    });

    server.on('error', error => {
      if (error.code === 'EADDRINUSE') return tryNextPort(currentPort, attemptsRemaining);
      console.error(`Oryn AI could not start: ${error.message}`);
      process.exitCode = 1;
    });
  }

  function startServer(currentPort, attemptsRemaining = 10) {
    if (currentPort === 0) return listenOnPort(currentPort, attemptsRemaining);

    const probe = net.createConnection({ host: '127.0.0.1', port: currentPort });
    probe.once('connect', () => {
      probe.destroy();
      tryNextPort(currentPort, attemptsRemaining);
    });
    probe.once('error', error => {
      if (error.code === 'ECONNREFUSED') return listenOnPort(currentPort, attemptsRemaining);
      console.error(`Oryn AI could not check port ${currentPort}: ${error.message}`);
      process.exitCode = 1;
    });
  }

  startServer(Number(port));
}

module.exports = app;