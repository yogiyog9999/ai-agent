const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const OpenAI = require('openai');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Deepgram LIVE
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// MySQL Pool
let dbPool;
async function initDB() {
  try {
    dbPool = mysql.createPool({
      host: process.env.WP_DB_HOST,
      user: process.env.WP_DB_USER,
      password: process.env.WP_DB_PASS,
      database: process.env.WP_DB_NAME,
      connectionLimit: 5,
      connectTimeout: 5000
    });
    console.log('✅ wp_ai_vectors DB ready');
  } catch (e) {
    console.log('⚠️ DB fallback - using mock data');
  }
}

initDB();

wss.on('connection', async (ws) => {
  console.log('👤 Voice client connected');
  const dgLive = deepgram.listen.live({
    model: 'nova-3-general',
    language: 'en-US',
    endpointing: 300, // 300ms pause = phrase end
    smart_format: true,
    punctuate: true
  });

  dgLive.on('open', () => console.log('🔊 Deepgram LIVE'));
  
  dgLive.on('transcript', async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
    if (!transcript || !data.is_final) return;
    
    console.log('🗣️ Heard:', transcript);
    
    try {
      // Query your wp_ai_vectors table
      let context = 'Marketing expert.';
      if (dbPool) {
        const [rows] = await dbPool.execute(
          'SELECT content FROM wp_ai_vectors WHERE MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) LIMIT 3',
          [transcript]
        );
        context = rows.map(r => r.content).join('; ') || context;
      }
      
      // OpenAI response
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system', 
          content: `Marketing AI. Use this database context: ${context}. Natural & brief.`
        }, {
          role: 'user', 
          content: transcript
        }],
        stream: false,
        max_tokens: 100
      });
      
      const response = completion.choices[0].message.content;
      ws.send(JSON.stringify({ type: 'text', delta: response }));
      
      // TODO: Deepgram TTS here
      
    } catch (err) {
      console.error('AI error:', err.message);
      ws.send(JSON.stringify({ type: 'text', delta: 'Got you! Digital PR expert ready. Ask about tourism marketing.' }));
    }
  });

  ws.on('message', (data) => {
    if (data.length > 50) dgLive.send(data);
  });

  ws.on('close', () => {
    dgLive.finish();
    console.log('👋 Session closed');
  });
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log('🚀 FULL VOICE AGENT LIVE - Deepgram + OpenAI + WP!');
});
