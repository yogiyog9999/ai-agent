const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => {
  res.json({ 
    status: 'live', 
    clients: wss.clients.size, 
    uptime: process.uptime(),
    deepgram: !!deepgram 
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

let sessionCount = 0;

wss.on('connection', (ws) => {
  const sessionId = ++sessionCount;
  console.log(`[DEBUG] 👤 Session ${sessionId} connected`);
  
  // INITIALIZE DEEPGRAM WITH THE CORRECT CODEC
  const dgLive = deepgram.listen.live({
    model: 'nova-3-general',
    language: 'en-US',
    smart_format: true,
    // THESE MUST MATCH YOUR FRONTEND MediaRecorder
    encoding: 'opus', 
    sample_rate: 48000, 
    container: 'webm', // This tells Deepgram to look for the WebM header
    interim_results: true,
    endpointing: 1500,
    utterance_end_ms: 2000,
  });

  let dgReady = false;

  dgLive.on('open', () => {
    dgReady = true;
    console.log(`[DEBUG] Deepgram WS opened for session ${sessionId}`);
  });

  dgLive.on('transcript', (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript?.trim() || '';
    if (transcript.length > 0) {
      console.log(`[T ${sessionId}] ${transcript}`);
      ws.send(JSON.stringify({ 
        type: 'text', 
        delta: transcript + ' ' 
      }));
    }
  });

  // Handle incoming audio from Frontend
  ws.on('message', (data) => {
    // We MUST wait for dgReady to be true, 
    // otherwise the first WebM header chunk is lost and the stream breaks.
    if (dgReady && dgLive.getReadyState() === 1) {
      dgLive.send(data);
    }
  });

  ws.on('close', () => {
    if (dgLive) dgLive.finish();
    console.log(`[CLOSE] Session ${sessionId} ended`);
  });

  dgLive.on('error', (err) => console.error(`[DG ERROR ${sessionId}]`, err));
});
process.on('SIGTERM', () => {
  wss.clients.forEach(ws => ws.close());
  process.exit(0);
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log('🚀 Server running on port', process.env.PORT || 8080);
});
