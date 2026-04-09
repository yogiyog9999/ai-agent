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

        // 1. Get Text from OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are Veronica, a brief human agent." },
                { role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText }
            ],
        });

        const replyText = completion.choices[0].message.content;

        // 2. Send Text immediately
        ws.send(JSON.stringify({ type: 'text', content: replyText }));

        // 3. Generate Audio (Specifically requesting 'wav' for browser compatibility)
        const response = await deepgram.speak.request(
            { text: replyText },
            { 
            model: "aura-asteria-en", // Try Asteria (very stable)
            container: "wav", 
            encoding: "linear16", 
            sample_rate: 48000
            }
        );

        // Get the stream as a buffer
        const stream = await response.getStream();
        if (stream) {
            const buffer = await response.getBuffer();
            console.log("Deepgram Buffer Generated, size:", buffer.byteLength);
            
            // 4. Send the binary audio
            ws.send(buffer); 
        } else {
            console.error("Deepgram failed to generate a stream.");
        }

    } catch (error) {
        console.error('Veronica Server Error:', error);
    }
});
    });
