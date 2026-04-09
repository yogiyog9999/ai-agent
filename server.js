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
    console.log("Client connected to Railway");

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

            // 2. BUILD THE DYNAMIC SYSTEM PROMPT
            const voiceAgentInstructions = `
                ${global_prompt}

                ROLE: You are Veronica, a professional human receptionist at CIPR Communications.
                MEDIUM: You are on a live voice call. 
                
                VOICE PROTOCOLS:
                1. BREVITY: Keep every response under 20 words. (Very important for voice).
                2. NATURAL: Use contractions like "I'm", "We'll", and "Don't". 
                3. PROACTIVE: If the user is silent or finished, ask: "Is there anything else I can help with?"
                4. CLOSURE: If the user says "Goodbye" or "Thanks", say a warm goodbye and include the word "Goodbye".
                5. SILENCE: If I send "Are you still there?", reply: "I'm still here! Let me know if you need anything, otherwise I'll clear the line."

                WEBSITE CONTEXT: ${context}
            `;

            // 3. ASSEMBLE MESSAGES
            let messages = [
                { role: "system", content: voiceAgentInstructions } // FIXED SYNTAX HERE
            ];
            
            if (history && history.length > 0) {
                history.forEach(h => messages.push(h));
            }
            
            messages.push({ role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText });

            // 4. GENERATE AI RESPONSE
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
                temperature: 0.7, // Adds a bit of human variety
            });
            const replyText = completion.choices[0].message.content;

            // Send text back to UI immediately
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 5. GENERATE HUMAN-LIKE AUDIO
           

           // 5. STREAM AUDIO (FINAL VERSION)

ws.send(JSON.stringify({ type: "audio_start" }));

const response = await deepgram.speak.request(
    { text: replyText },
    { 
        model: "aura-asteria-en",
        container: "wav",
        encoding: "linear16",
        prosody: { speed: 1.1 }
    }
);

const stream = await response.getStream();
const reader = stream.getReader();

while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    ws.send(value); // 🔥 real-time chunks
}

ws.send(JSON.stringify({ type: "audio_end" }));
      
            
            // Send audio buffer to browser

            // 6. SAVE MEMORY (Async - won't block the audio)
            axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'save_ai_memory',
                user_msg: userText,
                ai_msg: replyText
            })).catch(e => console.log("Memory Save Error"));

        } catch (error) {
            console.error('Veronica Bridge Error:', error.message);
        }
    });

    ws.on('close', () => console.log("Client disconnected"));
});
