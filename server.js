const http = require('http');
const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");
const axios = require('axios');

// 🔥 REQUIRED FOR RAILWAY
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Veronica Backend Running");
});

const wss = new WebSocket.Server({ server });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const WP_AJAX_URL = 'https://cipr.nestingstage.com/wp-admin/admin-ajax.php';

wss.on('connection', (ws) => {
    console.log("Client connected to Veronica");
    
    // Track current stream to allow for interruptions
    let currentAbortController = null;

    ws.on('message', async (message) => {
        try {
            // 🔥 INTERRUPT LOGIC: If we get a new message while still talking, stop the old one
            if (currentAbortController) {
                currentAbortController.abort();
            }
            currentAbortController = new AbortController();

            // Ignore raw binary from mic (handled by your Speech-to-Text logic elsewhere if needed)
            if (message instanceof Buffer) return;

            const data = JSON.parse(message);
            const userText = data.text;

            // 1. Fetch WordPress Context
            const wpResponse = await axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'get_veronica_context',
                message: userText
            }));

            const { context, global_prompt, history } = wpResponse.data;

            const systemPrompt = `${global_prompt}\n\nYou are Veronica, receptionist.\nKeep responses under 20 words.\n\n${context}`;

            let messages = [{ role: "system", content: systemPrompt }];
            if (history) history.forEach(h => messages.push(h));
            messages.push({ role: "user", content: userText });

            // 2. Generate Text Response
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages
            }, { signal: currentAbortController.signal });

            const replyText = completion.choices[0].message.content;

            // Send text to UI
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 3. Generate Audio Stream (ALEXA STYLE: Linear16 Raw PCM)
            ws.send(JSON.stringify({ type: "audio_start" }));

            const dgResponse = await deepgram.speak.request(
                { text: replyText },
                { 
                    model: "aura-asteria-en", 
                    encoding: "linear16", // Raw PCM is best for mobile streaming
                    container: "none",     // No headers = no delay
                    sample_rate: 24000     // Matches the Frontend AudioContext
                }
            );

            const stream = await dgResponse.getStream();
            const reader = stream.getReader();

            while (true) {
                // Check if this specific stream has been aborted by a newer user input
                if (currentAbortController.signal.aborted) {
                    console.log("Stream aborted - user interrupted.");
                    break;
                }

                const { done, value } = await reader.read();
                if (done) break;

                // Send raw binary chunks immediately
                ws.send(value);
            }

            ws.send(JSON.stringify({ type: "audio_end" }));

        } catch (err) {
            if (err.name === 'AbortError') {
                console.log("Request was cancelled by a new user input.");
            } else {
                console.log("ERROR:", err.message);
            }
        }
    });

    ws.on('close', () => {
        if (currentAbortController) currentAbortController.abort();
        console.log("Disconnected");
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
