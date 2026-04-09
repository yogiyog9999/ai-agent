const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

wss.on('connection', (ws) => {
    console.log('Caller connected');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const userText = data.text;

            // 1. Get Text Response from OpenAI
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are Veronica, a human receptionist. Be very brief (max 15 words)." },
                    { role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText }
                ],
            });

            const replyText = completion.choices[0].message.content;

            // 2. Send Text to Browser immediately for UI
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 3. Generate Audio via Deepgram Aura
            const response = await deepgram.speak.request(
                { text: replyText },
                { model: "aura-aura-en", encoding: "linear16", sample_rate: 48000 }
            );

            const buffer = await response.getBuffer();
            
            // 4. Send RAW Audio Buffer
            if (buffer) {
                ws.send(buffer); 
            }

        } catch (error) {
            console.error('Server Error:', error);
        }
    });
});
