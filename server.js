const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

wss.on('connection', (ws) => {
  console.log('👤 Client connected');
  let dgLive;

  // 1. Initialize Deepgram Live (STT)
  dgLive = deepgram.listen.live({
    model: 'nova-3-general',
    language: 'en-US',
    smart_format: true,
    endpointing: 500, // Wait 500ms after silence to "finalize"
  });

  dgLive.on('open', () => {
    dgLive.on('transcript', async (data) => {
      const transcript = data.channel.alternatives[0].transcript;
      if (transcript && data.is_final) {
        console.log(`🎤 User: ${transcript}`);
        
        // Send transcript to UI
        ws.send(JSON.stringify({ type: 'text', delta: `You: ${transcript}` }));

        // 2. TRIGGER AI RESPONSE & TTS
        // In a full setup, you'd call OpenAI here. 
        // For now, we use Deepgram Aura to "speak" the response back immediately.
        try {
          const responseText = `I heard you say: ${transcript}. How can I help with your marketing?`;
          
          const ttsResponse = await deepgram.speak.request(
            { text: responseText },
            { model: 'aura-asteria-en', encoding: 'linear16', sample_rate: 24000 }
          );

          const buffer = await ttsResponse.getBuffer();
          if (buffer) {
            // Send binary audio data to frontend
            ws.send(buffer); 
            ws.send(JSON.stringify({ type: 'text', delta: `\n🤖 Agent: ${responseText}` }));
          }
        } catch (err) {
          console.error('TTS Error:', err);
        }
      }
    });
  });

  // Handle incoming mic audio from frontend
  ws.on('message', (msg) => {
    if (Buffer.isBuffer(msg) || msg instanceof Uint8Array) {
      if (dgLive.getReadyState() === 1) dgLive.send(msg);
    }
  });

  ws.on('close', () => dgLive.finish());
});

server.listen(8080, () => console.log('🚀 Server at http://localhost:8080'));
