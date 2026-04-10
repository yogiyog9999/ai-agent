const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const OpenAI = require('openai');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Global DB pool - error-proof
let dbPool;
async function initDB() {
  try {
    dbPool = await mysql.createPool({
      host: process.env.WP_DB_HOST,
      user: process.env.WP_DB_USER,
      password: process.env.WP_DB_PASS,
      database: process.env.WP_DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000,
      ssl: { rejectUnauthorized: false }
    });
    console.log('✅ MySQL Pool ready');
  } catch (err) {
    console.error('❌ DB Error - Graceful fallback:', err.message);
    // Continue without DB - use mock data
  }
}

const deepgram = createClient(process.env.DEEPGRAM_API_KEY || '');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const WP_TABLE = process.env.WP_TABLE_NAME || 'wp_ai_vectors';

initDB(); // Non-blocking startup

wss.on('connection', async (ws) => {
  console.log('👤 Client connected');
  
  const dgLive = deepgram.listen.live({
    model: 'nova-3-general',
    language: 'en-US',
    smart_format: true
  });

  dgLive.on('transcript', async (data) => {
    if (!data?.channel?.alternatives?.[0]?.transcript) return;
    const transcript = data.channel.alternatives[0].transcript.trim();
    if (data.is_final && transcript) {
      try {
        // Safe DB query with fallback
        let context = 'Marketing agency expert.';
        if (dbPool) {
          const [rows] = await dbPool.execute(
            `SELECT content FROM ${WP_TABLE} WHERE MATCH(content) AGAINST(?) LIMIT 3`,
            [transcript]
          );
          context = rows.map(r => r.content).join('; ') || context;
        }
        
        // OpenAI Realtime session
        const realtimeWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
          headers: { 
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1'
          }
        });

        realtimeWs.on('open', () => {
          realtimeWs.send(JSON.stringify({
            type: 'session.update',
            session: { 
              instructions: `Marketing AI agent. Use this context: ${context}. Keep responses short & natural.`,
              modalities: ['text', 'audio'],
              voice: 'alloy'
            }
          }));
          realtimeWs.send(JSON.stringify({
            type: 'conversation.item.create',
            item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: transcript }] }
          }));
          realtimeWs.send(JSON.stringify({ type: 'response.create' }));
        });

        realtimeWs.on('message', (data) => {
          try {
            const event = JSON.parse(data.toString());
            if (event.type === 'response.text.delta') {
              ws.send(JSON.stringify({ type: 'text', delta: event.delta }));
            } else if (event.type === 'response.audio.delta') {
              ws.send(JSON.stringify({ type: 'audio', data: event.delta.toString('base64') }));
            }
          } catch (e) { console.error('Realtime parse:', e); }
        });

      } catch (err) {
        console.error('Handler error:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: 'Service busy, try again' }));
      }
    }
  });

  // Ping heartbeat
  const pingInt = setInterval(() => ws.ping(), 15000);
  ws.on('close', () => {
    clearInterval(pingInt);
    dgLive.finish();
    console.log('👋 Client disconnected');
  });

  ws.on('message', (data) => dgLive.send(data));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
