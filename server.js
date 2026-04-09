const http = require('http');
const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");
const axios = require('axios');

// 🔥 REQUIRED FOR RAILWAY
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("WebSocket Server Running");
});

const wss = new WebSocket.Server({ server });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const WP_AJAX_URL = 'https://cipr.nestingstage.com/wp-admin/admin-ajax.php';

wss.on('connection', (ws) => {

    console.log("Client connected");

    ws.on('message', async (message) => {

        try {

            // 🔥 IMPORTANT: IGNORE AUDIO FOR NOW
            if (message instanceof Buffer) return;

            const data = JSON.parse(message);
            const userText = data.text;

            // 🔥 WORDPRESS CONTEXT
            const wpResponse = await axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'get_veronica_context',
                message: userText
            }));

            const { context, global_prompt, history } = wpResponse.data;

            const systemPrompt = `
${global_prompt}

You are Veronica, receptionist.
Keep responses under 20 words.

${context}
`;

            let messages = [{ role: "system", content: systemPrompt }];

            if (history) history.forEach(h => messages.push(h));

            messages.push({ role: "user", content: userText });

            // 🤖 AI RESPONSE
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages
            });

            const replyText = completion.choices[0].message.content;

            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 🔊 AUDIO STREAM
            ws.send(JSON.stringify({ type: "audio_start" }));

            const dg = await deepgram.speak.request(
                { text: replyText },
                { model: "aura-asteria-en", container: "mp3" }
            );

            const stream = await dg.getStream();
            const reader = stream.getReader();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                ws.send(value);
            }

            ws.send(JSON.stringify({ type: "audio_end" }));

        } catch (err) {
            console.log("ERROR:", err.message);
        }
    });

    ws.on('close', () => console.log("Disconnected"));
});

// 🔥 THIS LINE FIXES YOUR ERROR
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
    console.log("Server running on port", PORT);
});
