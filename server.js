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
            // 🔥 INTERRUPT LOGIC
            if (currentAbortController) {
                currentAbortController.abort();
            }
            currentAbortController = new AbortController();

            // Ignore raw binary from mic
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

            // 3. Generate Audio Stream (ALEXA STYLE)
            ws.send(JSON.stringify({ type: "audio_start" }));
            console.log("Deepgram: Requesting audio for:", replyText);

            try {
                const response = await deepgram.speak.request(
                    { text: replyText },
                    { 
                        model: "aura-asteria-en", 
                        encoding: "linear16", 
                        container: "none", 
                        sample_rate: 24000 
                    }
                );

                const stream = await response.getStream();
                const reader = stream.getReader();

                let chunkCount = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        console.log(`Deepgram: Stream finished. Sent ${chunkCount} chunks.`);
                        break;
                    }

                    if (value && value.byteLength > 0) {
                        ws.send(value); 
                        chunkCount++;
                    }
                }
                ws.send(JSON.stringify({ type: "audio_end" }));

            } catch (dgError) {
                console.error("Deepgram Error:", dgError.message);
                ws.send(JSON.stringify({ type: "error", message: "Audio generation failed" }));
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                console.log("Request aborted due to interruption.");
            } else {
                console.error("Main Process Error:", err.message);
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
