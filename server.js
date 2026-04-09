const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");
const axios = require('axios'); // For talking to WordPress

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// UPDATE THIS TO YOUR SITE URL
const WP_AJAX_URL = 'https://cipr.nestingstage.com/wp-admin/admin-ajax.php';

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const userText = data.text;

            // 1. FETCH DATA FROM WORDPRESS
            const wpResponse = await axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'get_veronica_context',
                message: userText
            }));
            const { context, global_prompt, history } = wpResponse.data;

            // 2. BUILD THE MESSAGES (Original Logic)
            let messages = [
                { 
                    role: "system", 
                    content: `${global_prompt}\n\nROLE: Veronica, human receptionist.\nSTYLE: Brief (under 20 words).\nWEBSITE CONTEXT: ${context}` 
                }
            ];
            
            // Add existing history
            if (history && history.length > 0) {
                history.forEach(h => messages.push(h));
            }
            
            // Add current message
            messages.push({ role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText });

            // 3. GENERATE OPENAI TEXT
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
            });
            const replyText = completion.choices[0].message.content;

            // 4. SEND TEXT & AUDIO
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            const response = await deepgram.speak.request(
                { text: replyText },
                { model: "aura-asteria-en", container: "wav", encoding: "linear16" }
            );

            const stream = await response.getStream();
            const reader = stream.getReader();
            let chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            ws.send(Buffer.concat(chunks));

            // 5. SAVE MEMORY BACK TO WORDPRESS (Async)
            axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'save_ai_memory',
                user_msg: userText,
                ai_msg: replyText
            })).catch(e => console.log("Memory Save Error"));

        } catch (error) {
            console.error('Veronica Bridge Error:', error.message);
        }
    });
});
