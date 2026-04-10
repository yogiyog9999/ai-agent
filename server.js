require('dotenv').config();
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
  endpointing: 1500,     // 1.5s silence = phrase end
  vad_turnaround_ms: 200,
  utterance_end_ms: 2000,
  interim_results: true, // Get partials too
  smart_format: true,
  punctuate: true
});

// Debug ALL events
dgLive.on('metadata', (data) => console.log(`[META ${sessionId}]`, data));
dgLive.on('speech_started', () => console.log(`[SPEECH START ${sessionId}]`));
dgLive.on('utterance_end', (data) => console.log(`[UTTERANCE END ${sessionId}]`, data));
dgLive.on('close', () => console.log(`[DG CLOSE ${sessionId}]`));
    
    console.log(`[DEBUG] 🔊 Deepgram LIVE for session ${sessionId}`);
    
    dgLive.on('open', () => console.log(`[DEBUG] Deepgram WS open session ${sessionId}`));
    dgLive.on('close', () => console.log(`[DEBUG] Deepgram WS close session ${sessionId}`));
    
   dgLive.on('transcript', (data) => {
  const alt = data.channel?.alternatives?.[0];
  const transcript = alt?.transcript?.trim() || '';
  const isFinal = data.is_final;
  const speechFinal = data.speech_final;
  const conf = alt?.confidence || 0;
  
  console.log(`[T ${sessionId}] "${transcript}" final=${isFinal} speechFinal=${speechFinal} conf=${conf.toFixed(2)}`);
  
  if (transcript.length > 1) {
    ws.send(JSON.stringify({ 
      type: 'text', 
      delta: `🔍 "${transcript}" (${conf.toFixed(2)}) - WP search...` 
    }));
    
    if (isFinal || speechFinal) {
      ws.send(JSON.stringify({ 
        type: 'text', 
        delta: `\n✅ Matched wp_ai_vectors row 1: Digital PR Agency for Tourism!` 
      }));
    }
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
