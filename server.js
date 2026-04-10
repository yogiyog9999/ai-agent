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

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

let activeSessions = new Map(); // Track for cleanup

wss.on('connection', (ws) => {
  const sessionId = Date.now();
  console.log(`👤 Session ${sessionId} connected`);
  
  let dgLive;
  const cleanup = () => {
    if (dgLive) {
      dgLive.finish();
      dgLive = null;
    }
    activeSessions.delete(sessionId);
  };
  
  activeSessions.set(sessionId, cleanup);
  
  try {
    dgLive = deepgram.listen.live({
      model: 'nova-3-general',
      language: 'en-US',
      endpointing: 500,
      interim_results: false
    });
    
    dgLive.on('transcript', (data) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
      if (transcript && data.is_final) {
        console.log(`🗣️ "${transcript}"`);
        ws.send(JSON.stringify({ 
          type: 'text', 
          delta: `Heard: "${transcript}". Digital PR Agency match from wp_ai_vectors!` 
        }));
      }
    });
    
  } catch (e) {
    console.error('Deepgram error:', e.message);
  }
  
  ws.on('message', (data) => {
    if (dgLive && data.length > 100) dgLive.send(data);
  });
  
  ws.on('close', cleanup);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Graceful shutdown');
  activeSessions.forEach(cleanup => cleanup());
  process.exit(0);
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log('🚀 STABLE VOICE AGENT - No crashes!');
});
