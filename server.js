const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");
const axios = require('axios');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const WP_AJAX_URL = 'https://cipr.nestingstage.com/wp-admin/admin-ajax.php';

wss.on('connection', (ws) => {
    console.log("Client connected to Veronica Bridge");

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Handle interrupt signal from mobile client
            if (data.type === 'interrupt') {
                return; // Server stops processing current task
            }

            const userText = data.text;

            // 1. FETCH WORDPRESS DATA
            const wpResponse = await axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'get_veronica_context',
                message: userText
            }));
            
            const { context, global_prompt, history } = wpResponse.data;

            // 2. GENERATE AI RESPONSE
            const messages = [
                { role: "system", content: `${global_prompt} ROLE: Veronica. BREVITY: Max 20 words. CONTEXT: ${context}` },
                ...(history || []),
                { role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText }
            ];

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
                temperature: 0.6,
            });
            
            const replyText = completion.choices[0].message.content;

            // Send text back immediately
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 3. STREAMING DEEPGRAM AUDIO (RAW PCM)
            const response = await deepgram.speak.request(
                { text: replyText },
                { 
                    model: "aura-asteria-en", 
                    encoding: "linear16", 
                    container: "none", // Send raw chunks
                    sample_rate: 24000,
                    prosody: { speed: 1.1 } 
                }
            );

            const stream = await response.getStream();
            const reader = stream.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                // Send raw binary buffer to client
                ws.send(value); 
            }

            // Signal audio stream complete
            ws.send(JSON.stringify({ type: 'audio_done' }));

            // Save Memory (Background)
            axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'save_ai_memory',
                user_msg: userText,
                ai_msg: replyText
            })).catch(() => {});

        } catch (error) {
            console.error('Bridge Error:', error.message);
        }
    });
});
