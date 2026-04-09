const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

wss.on('connection', (ws) => {
    console.log('Caller connected to Veronica');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const userText = data.text;

            // 1. OpenAI Text Generation
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are Veronica, a receptionist. Be very brief (max 12 words)." },
                    { role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText }
                ],
            });

            const replyText = completion.choices[0].message.content;

            // 2. Send Text back to Browser
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 3. Deepgram Text-to-Speech (Aura)
            // Note: In SDK v3, we use speak.request()
            const response = await deepgram.speak.request(
                { text: replyText },
                { model: "aura-asteria-en", encoding: "linear16", container: "wav" }
            );

            // THE FIX: How to get the buffer in SDK v3
            const stream = await response.getStream();
            if (stream) {
                const buffer = await response.getBuffer(); // This now works inside the stream check
                console.log("Audio Buffer generated successfully, sending...");
                ws.send(buffer); 
            } else {
                console.error("No stream returned from Deepgram");
            }

        } catch (error) {
            console.error('Veronica Server Error:', error.message);
        }
    });
});

console.log(`Server live on port ${port}`);
