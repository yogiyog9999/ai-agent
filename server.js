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

    console.log("Client connected");

    ws.on('message', async (message) => {

        try {

            // ✅ 1. HANDLE BINARY AUDIO (MIC STREAM)
            if (message instanceof Buffer) {
                // 🔥 For now we IGNORE mic audio (no JSON parse error)
                // 👉 Later we can send this to Deepgram STT
                return;
            }

            // ✅ 2. SAFE JSON PARSE
            let data;
            try {
                data = JSON.parse(message.toString());
            } catch (e) {
                console.log("Invalid JSON skipped");
                return;
            }

            // ✅ 3. VALIDATE MESSAGE
            if (!data.text) return;

            const userText = data.text;

            // 🔥 4. FETCH WORDPRESS DATA (RAG)
            const wpResponse = await axios.post(
                WP_AJAX_URL,
                new URLSearchParams({
                    action: 'get_veronica_context',
                    message: userText
                })
            );

            const { context, global_prompt, history } = wpResponse.data;

            // 🔥 5. BUILD SYSTEM PROMPT
            const systemPrompt = `
${global_prompt}

ROLE: You are Veronica, a professional human receptionist.
Keep responses under 20 words.
Speak naturally like a human.

WEBSITE DATA:
${context}
`;

            let messages = [
                { role: "system", content: systemPrompt }
            ];

            // 🔥 HISTORY SUPPORT
            if (history && history.length) {
                history.forEach(h => messages.push(h));
            }

            messages.push({
                role: "user",
                content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText
            });

            // 🔥 6. AI RESPONSE
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages,
                temperature: 0.7
            });

            const replyText = completion.choices[0].message.content;

            // 👉 SEND TEXT INSTANTLY
            ws.send(JSON.stringify({
                type: 'text',
                content: replyText
            }));

            // 🔥 7. STREAM AUDIO (REAL-TIME)
            ws.send(JSON.stringify({ type: "audio_start" }));

            const dgResponse = await deepgram.speak.request(
                { text: replyText },
                {
                    model: "aura-asteria-en",
                    container: "mp3" // ✅ BEST for mobile
                }
            );

            const stream = await dgResponse.getStream();
            const reader = stream.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(value); // 🎧 STREAM CHUNK
                }
            }

            ws.send(JSON.stringify({ type: "audio_end" }));

            // 🔥 8. SAVE MEMORY (ASYNC)
            axios.post(
                WP_AJAX_URL,
                new URLSearchParams({
                    action: 'save_ai_memory',
                    user_msg: userText,
                    ai_msg: replyText
                })
            ).catch(() => { });

        } catch (err) {
            console.log("Server Error:", err.message);
        }
    });

    ws.on('close', () => {
        console.log("Disconnected");
    });
});
