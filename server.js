const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");
const axios = require('axios');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const WP_AJAX_URL = 'https://cipr.nestingstage.com/wp-admin/admin-ajax.php';

// WAV Header Generator
function getWavHeader(dataLength) {
    const buffer = Buffer.alloc(44);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);  // PCM
    buffer.writeUInt16LE(1, 22);  // Mono
    buffer.writeUInt32LE(24000, 24);
    buffer.writeUInt32LE(24000 * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
}

wss.on('connection', (ws) => {
    console.log("Client connected to Veronica Bridge");

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'interrupt') {
                return;
            }

            const userText = data.text;

            // 1. WORDPRESS CONTEXT
            const wpResponse = await axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'get_veronica_context',
                message: userText
            })).catch(() => ({}));
            
            const { context, global_prompt, history } = wpResponse.data || {};

            // 2. OPENAI RESPONSE
            const messages = [
                { role: "system", content: `${global_prompt || "You are Veronica."} ROLE: Veronica. BREVITY: Max 20 words. CONTEXT: ${context || ""}` },
                ...(history || []),
                { role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText }
            ];

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
                temperature: 0.6,
            });
            
            const replyText = completion.choices[0].message.content;

            // Send text immediately
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 3. DEEPGRAM - FULL FILE (NO CHUNKS!)
            const response = await deepgram.speak.request(
                { text: replyText },
                { 
                    model: "aura-asteria-en", 
                    encoding: "linear16", 
                    container: "wav",  // FULL WAV FILE
                    sample_rate: 24000,
                    prosody: { speed: 1.1 } 
                }
            );

            // Get COMPLETE audio file (no streaming)
            const audioBuffer = await response.getAudio();
            
            // Send ONE complete WAV file
            ws.send(audioBuffer);

            // Signal complete
            ws.send(JSON.stringify({ type: 'audio_done' }));

            // Background memory save
            axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'save_ai_memory',
                user_msg: userText,
                ai_msg: replyText
            })).catch(() => {});

        } catch (error) {
            console.error('Bridge Error:', error.message);
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
    });
});
