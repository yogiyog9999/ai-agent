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
  
  // 1. Setup Deepgram Live with explicit encoding
  const dgLive = deepgram.listen.live({
    model: 'nova-3-general',
    language: 'en-US',
    smart_format: true,
    // CRITICAL: Most browser MediaRecorders use opus/webm
    encoding: 'opus', 
    sample_rate: 48000, 
    interim_results: true,
    endpointing: 1500,
    utterance_end_ms: 2000,
    vad_turnaround_ms: 200,
  });

  let dgReady = false;

  // 2. Listeners must be attached immediately
  dgLive.on('open', () => {
    dgReady = true;
    console.log(`[DEBUG] Deepgram WS opened for session ${sessionId}`);
  });

  dgLive.on('transcript', (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript?.trim() || '';
    const isFinal = data.is_final;
    const speechFinal = data.speech_final;

    if (transcript.length > 0) {
      console.log(`[T ${sessionId}] "${transcript}" (Final: ${isFinal})`);
      
      ws.send(JSON.stringify({ 
        type: 'text', 
        delta: transcript,
        isFinal: isFinal || speechFinal
      }));
    }
  });

  dgLive.on('error', (err) => console.error(`[DG ERROR ${sessionId}]`, err));
  dgLive.on('close', () => console.log(`[DG CLOSE ${sessionId}] Connection closed`));

  // 3. Handle incoming audio from Client
  ws.on('message', (data) => {
    // Only send to Deepgram if the connection is actually open
    if (dgReady && dgLive.getReadyState() === 1) {
      dgLive.send(data);
    }
  });

  // Heartbeat to keep Railway connection alive
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 30000);

  ws.on('close', () => {
    console.log(`[CLOSE] Session ${sessionId} ended`);
    clearInterval(heartbeat);
    dgLive.finish();
  });
});

process.on('SIGTERM', () => {
  wss.clients.forEach(ws => ws.close());
  process.exit(0);
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log('🚀 Server running on port', process.env.PORT || 8080);
});
