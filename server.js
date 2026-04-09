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
const HUMAN_FILLERS = [
    "Hmm, let me look into that for you...",
    "That's a great question, one moment...",
    "Let me see what I can find on that...",
    "Just checking my records here...",
    "Sure thing, let me pull that up..."
];
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

            const voiceAgentInstructions = `
    ${global_prompt}

    ROLE: You are Veronica, a professional human receptionist at CIPR Communications.
    MEDIUM: You are on a live voice call. 
    
    VOICE PROTOCOLS:
    1. BREVITY: Keep every response under 25 words. Users hate long talking in voice.
    2. NATURAL: Use contractions like "I'm", "We'll", and "Don't". 
    3. PROACTIVE: If the user seems lost, ask: "Is there anything else I can help you with?"
    4. CLOSURE: If the user says "Goodbye", "That is all", or "Thanks", say a warm goodbye and include the word "Goodbye".
    5. SILENCE: If I send you "Are you still there?", reply with: "I'm still here if you need help, otherwise I can clear the line for you."

    WEBSITE CONTEXT: ${context}
`;
            // 2. BUILD THE MESSAGES (Original Logic)
            let messages = [
                { 
                    role: "system", 
                    content: voiceAgentInstructions` 
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
