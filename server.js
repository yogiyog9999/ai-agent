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
            const userText = data.text;

            // 1. OpenAI Text Generation
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are Veronica, a warm receptionist. Under 15 words." },
                    { role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText }
                ],
            });

            const replyText = completion.choices[0].message.content;

            // 2. Send Text back for UI
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 3. Deepgram Text-to-Speech
            const response = await deepgram.speak.request(
                { text: replyText },
                { model: "aura-asteria-en", container: "wav", encoding: "linear16" }
            );

            // THE FIX: Convert Stream to Buffer manually
            const stream = await response.getStream();
            const reader = stream.getReader();
            let chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }

            // Combine all chunks into one Buffer
            const finalBuffer = Buffer.concat(chunks);

            if (finalBuffer.length > 0) {
                console.log("Audio Buffer sent to client:", finalBuffer.length);
                ws.send(finalBuffer); // Send as binary frame
            }

        } catch (error) {
            console.error('Veronica Server Error:', error.message);
        }
    });
});
