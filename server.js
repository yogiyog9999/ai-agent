require('dotenv').config();
const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require("@deepgram/sdk");
const axios = require('axios');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const WP_AJAX_URL = 'https://cipr.nestingstage.com/wp-admin/admin-ajax.php';

console.log(`Veronica Bridge Active on Port ${port}`);

wss.on('connection', (ws) => {
    console.log("Client connected to Veronica");

    // Tracks the current active processes for this specific user session
    let currentAbortController = null;
    let activeAudioReader = null;
    let isInterrupted = false;

    ws.on('message', async (message) => {
        try {
            // Handle binary data (if any sent from client)
            if (message instanceof Buffer) return;

            const data = JSON.parse(message);

            // --- 1. IMMEDIATE INTERRUPT HANDLER ---
            if (data.type === 'interrupt') {
                console.log("!!! Interrupt Signal Received !!!");
                isInterrupted = true;
                
                // Kill OpenAI request
                if (currentAbortController) currentAbortController.abort();
                
                // Kill Deepgram stream reader
                if (activeAudioReader) {
                    await activeAudioReader.cancel();
                    activeAudioReader = null;
                }
                return;
            }

            // --- 2. START NEW REQUEST CYCLE ---
            isInterrupted = false;
            currentAbortController = new AbortController();
            const userText = data.text;

            // 3. FETCH WORDPRESS CONTEXT
            let wpData = { context: "", global_prompt: "You are Veronica.", history: [] };
            try {
                const wpResponse = await axios.post(WP_AJAX_URL, new URLSearchParams({
                    action: 'get_veronica_context',
                    message: userText
                }), { timeout: 4000 });
                wpData = wpResponse.data;
            } catch (e) {
                console.error("WordPress Context Fetch Error:", e.message);
            }

            // Check if user spoke again while we were fetching context
            if (isInterrupted) return;

            // 4. GPT-4o-MINI COMPLETION (With Abort Signal)
            const messages = [
                { role: "system", content: `${wpData.global_prompt} ROLE: Veronica. BREVITY: Max 20 words. CONTEXT: ${wpData.context}` },
                ...(wpData.history || []),
                { role: "user", content: userText === "GENERATE_WELCOME_GREETING" ? "Hello" : userText }
            ];

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
                temperature: 0.6,
            }, { signal: currentAbortController.signal });

            const replyText = completion.choices[0].message.content;

            if (isInterrupted) return;

            // Send text back to UI for the live caption/preview
            ws.send(JSON.stringify({ type: 'text', content: replyText }));

            // 5. DEEPGRAM VOICE STREAMING
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
            activeAudioReader = stream.getReader();

            while (true) {
                // If the user starts talking, stop the loop immediately
                if (isInterrupted) {
                    console.log("Stopping audio stream: User Interrupted.");
                    break;
                }

                const { done, value } = await activeAudioReader.read();
                if (done) break;

                // Send raw binary chunks to the custom.js buffer
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(value); 
                }
            }

            if (!isInterrupted) {
                ws.send(JSON.stringify({ type: 'audio_done' }));
            }

            // 6. SAVE MEMORY (Fire and forget)
            if (!isInterrupted && userText !== "GENERATE_WELCOME_GREETING") {
                axios.post(WP_AJAX_URL, new URLSearchParams({
                    action: 'save_ai_memory',
                    user_msg: userText,
                    ai_msg: replyText
                })).catch(() => {});
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log("Request aborted successfully.");
            } else {
                console.error('Veronica Server Error:', error.message);
            }
        }
    });

    ws.on('close', () => {
        isInterrupted = true;
        if (currentAbortController) currentAbortController.abort();
        console.log("Veronica Disconnected");
    });
});
