const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const OpenAI = require('openai');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public')); // Serve HTML/JS client

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const WP_TABLE = process.env.WP_TABLE_NAME || 'your_table';

let db;
(async () => {
  db = await mysql.createConnection({
    host: process.env.WP_DB_HOST,
    user: process.env.WP_DB_USER,
    password: process.env.WP_DB_PASS,
    database: process.env.WP_DB_NAME,
    ssl: { rejectUnauthorized: false }
  });
})();

wss.on('connection', async (ws) => {
  console.log('Client connected');
  const dgLive = deepgram.listen.live({
    model: 'nova-3-general',
    language: 'en-US',
    smart_format: true,
    punctuate: true
  });

  dgLive.on('open', () => console.log('Deepgram connected'));
  dgLive.on('transcript', async (data) => {
    if (!data || !data.channel || !data.channel.alternatives?.[0]?.transcript) return;
    const transcript = data.channel.alternatives[0].transcript.trim();
    if (data.is_final && transcript) {
      // Fast WP table query
     const [rows] = await db.execute(
  `SELECT content FROM wp_ai_vectors 
   WHERE MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) 
   LIMIT 5`, [transcript]
);
const context = rows.map(row => row.content).slice(0,3).join('\n\n'); // Top 3 for speed
      // Send to OpenAI Realtime (server-side session)
      const realtimeWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
      });

      realtimeWs.on('open', () => {
        realtimeWs.send(JSON.stringify({
          type: 'session.update',
          session: { instructions: `You are a helpful assistant. Use this WP context: ${context}. Respond conversationally.` }
        }));
        realtimeWs.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: transcript }] }
        }));
        realtimeWs.send(JSON.stringify({ type: 'response.create' }));
      });

      realtimeWs.on('message', async (data) => {
        const event = JSON.parse(data);
        if (event.type === 'response.audio.delta') {
          // Stream TTS audio back via Deepgram for better quality if needed, or direct
          const tts = await deepgram.speak.start({ model: 'aura-asteria-en' });
          // Pipe audio to client
          ws.send(JSON.stringify({ type: 'audio', data: event.delta }));
        } else if (event.type === 'response.text.delta') {
          ws.send(JSON.stringify({ type: 'text', delta: event.delta }));
        }
      });
    }
  });

  ws.on('message', (message) => {
    const data = Buffer.from(message);
    dgLive.send(data);
  });

  ws.on('close', () => {
    dgLive.finish();
    console.log('Client disconnected');
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Server running on port', server.address().port));
