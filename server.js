const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

wss.on('connection', (ws) => {
    console.log('Veronica: Call connected');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'chat') {
                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: "You are Veronica, a warm human receptionist. Be brief (under 15 words)." },
                        { role: "user", content: data.text }
                    ],
                });

                const replyText = completion.choices[0].message.content;

                // 1. Send the text back so the UI updates
                ws.send(JSON.stringify({ type: 'text', content: replyText }));

                // 2. Request human-like audio from Deepgram Aura
                const response = await deepgram.speak.request(
                    { text: replyText },
                    { model: "aura-aura-en" } // Aura is the fastest for conversation
                );

                const stream = await response.getStream();
                if (stream) {
                    const buffer = await response.getBuffer();
                    // 3. Send the raw audio buffer to the browser
                    ws.send(buffer);
                }
            }
        } catch (error) {
            console.error('Error:', error);
        }
    });
});

console.log(`Server running on ${port}`);
