const WebSocket = require('ws');
const OpenAI = require('openai');

// Railway provides the PORT environment variable automatically
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

// Initialize OpenAI using Railway Environment Variables
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

wss.on('connection', (ws) => {
    console.log('Veronica connected to a new caller.');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'chat') {
                const stream = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { 
                            role: "system", 
                            content: `You are Veronica, a warm, professional human receptionist at CIPR Communications. 
                                     Style: Under 20 words. No markdown. Use natural contractions. 
                                     Context: ${data.context || "General inquiry"}` 
                        },
                        { role: "user", content: data.text }
                    ],
                    stream: true,
                });

                for await (const chunk of stream) {
                    const content = chunk.choices[0]?.delta?.content || "";
                    if (content) {
                        // Send text chunks as soon as they are generated
                        ws.send(JSON.stringify({ type: 'text', content }));
                    }
                }
                ws.send(JSON.stringify({ type: 'end' }));
            }
        } catch (error) {
            console.error('Error:', error);
            ws.send(JSON.stringify({ type: 'error', content: "I'm sorry, I'm having trouble connecting." }));
        }
    });

    ws.on('close', () => console.log('Caller disconnected.'));
});

console.log(`WSS Server active on port ${port}`);
