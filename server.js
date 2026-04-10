const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('👤 Client connected');
  let silenceCount = 0;
  let lastResponseTime = 0;
  
  ws.send(JSON.stringify({ type: 'text', delta: '🎉 LIVE! Say "digital PR" or "hospitality marketing"...' }));
  
  ws.on('message', (data) => {
    console.log('📦 Chunk:', data.length);
    
    if (data.length < 50) {
      silenceCount++;
      if (silenceCount > 10) { // 2.5s silence
        ws.send(JSON.stringify({ type: 'text', delta: '\n\n⏸️ Listening... Speak again!' }));
        silenceCount = 0;
      }
      return;
    }
    
    silenceCount = 0;
    const now = Date.now();
    if (now - lastResponseTime < 3000) return; // 3s cooldown
    
    // Your wp_ai_vectors demo
    ws.send(JSON.stringify({ 
      type: 'text', 
      delta: 'Digital PR & Marketing Agency for Tourism (row 1 from wp_ai_vectors). Ask about hospitality or AI marketing!' 
    }));
    lastResponseTime = now;
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LIVE on port ${PORT}`);
});
