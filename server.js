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
  
  ws.on('message', (data) => {
    console.log('📦 Audio:', data.length, 'bytes');
    // Echo test + future Deepgram
    ws.send(JSON.stringify({ type: 'text', delta: 'Heard you! Marketing AI live. Say "digital PR" for demo.' }));
    
    // Simulate response from wp_ai_vectors row 1
    setTimeout(() => {
      ws.send(JSON.stringify({ 
        type: 'text', 
        delta: 'Digital PR & Marketing Agency for Tourism - perfect match from your database!' 
      }));
    }, 1000);
  });
  
  ws.on('close', () => console.log('👋 Disconnected'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LIVE on port ${PORT}`);
});
