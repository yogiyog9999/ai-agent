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
app.get('/health', (req, res) => res.json({ status: 'live', time: new Date().toISOString() }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const deepgram = createClient(process.env.DEEPGRAM_API_KEY || 'demo');
let sessionCount = 0;

wss.on('connection', (ws) => {
  const sessionId = ++sessionCount;
  console.log(`[DEBUG] 👤 Session ${sessionId} connected (${wss.clients.size} active)`);
  
  let dgLive;
  
  // Heartbeat every 30s - Railway killer
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      console.log(`[HEARTBEAT] Session ${sessionId} alive`);
    }
  }, 30000);
  
  ws.on('pong', () => console.log(`[PONG] Session ${sessionId}`));
  
  try {
    dgLive = deepgram.listen.live({
      model: 'nova-3-general',
      language: 'en-US',
      endpointing: 700,
      vad_turnaround_ms: 100,
      request_id: `railway-${sessionId}`
    });
    
    console.log(`[DEBUG] 🔊 Deepgram LIVE for session ${sessionId}`);
    
    dgLive.on('open', () => console.log(`[DEBUG] Deepgram WS open session ${sessionId}`));
    dgLive.on('close', () => console.log(`[DEBUG] Deepgram WS close session ${sessionId}`));
    
    dgLive.on('transcript', (data) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
      const isFinal = data.is_final;
      console.log(`[TRANSCRIPT ${sessionId}] "${transcript}" final=${isFinal} confidence=${data.channel?.alternatives?.[0]?.confidence || 'N/A'}`);
      
      if (transcript && isFinal && transcript.length > 2) {
        ws.send(JSON.stringify({ 
          type: 'text', 
          delta: `🎯 Heard "${transcript}" - WP marketing match! (conf: ${data.channel.alternatives[0].confidence.toFixed(2)})` 
        }));
      }
    });
    
    dgLive.on('error', (err) => {
      console.error(`[DEEPGRAM ERROR ${sessionId}]`, err);
    });
    
  } catch (err) {
    console.error(`[DEEPGRAM INIT ERROR ${sessionId}]`, err.message);
  }
  
  let chunkCount = 0;
  ws.on('message', (data) => {
    chunkCount++;
    const size = data.length;
    console.log(`[AUDIO ${sessionId}] Chunk #${chunkCount} size=${size}B`);
    
    if (dgLive && size > 50) {
      dgLive.send(data);
    }
  });
  
  ws.on('close', () => {
    clearInterval(heartbeat);
    if (dgLive) dgLive.finish();
    console.log(`[CLOSE] Session ${sessionId} ended (chunks: ${chunkCount})`);
  });
  
  ws.on('error', (err) => console.error(`[WS ERROR ${sessionId}]`, err));
});

// Railway health + graceful SIGTERM
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received - cleaning up');
  wss.clients.forEach(ws => ws.close());
  process.exit(0);
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log('🚀 DEBUG AGENT LIVE - Check /health');
});
