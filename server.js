const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require('@deepgram/sdk');
const axios = require('axios');

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const WP_AJAX_URL = 'https://cipr.nestingstage.com/wp-admin/admin-ajax.php';

wss.on('connection', (ws) => {
    console.log('Client connected');
    let abortController = null;

    ws.on('message', async (msg) => {
        try {
            const data = JSON.parse(msg);
            
            if (data.type === 'interrupt') {
                abortController?.abort();
                return;
            }

            abortController = new AbortController();
            const userText = data.text;

            // WP Context
            const wpData = await axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'get_veronica_context',
                message: userText
            })).catch(() => ({}));

            const messages = [{
                role: 'system',
                content: `${wpData.data?.global_prompt || 'You are Veronica.'} Keep responses under 20 words.`
            }, ...(wpData.data?.history || []), {
                role: 'user',
                content: userText === 'GENERATE_WELCOME_GREETING' ? 'Hello' : userText
            }];

            // OpenAI
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages,
                temperature: 0.6
            }, { signal: abortController.signal });

            const reply = completion.choices[0].message.content;
            ws.send(JSON.stringify({ type: 'text', content: reply }));

            // Deepgram TTS (raw PCM only)
            const ttsResponse = await deepgram.speak.request({ text: reply }, {
                model: 'aura-asteria-en',
                encoding: 'linear16',
                sample_rate: 24000,
                container: 'none'
            });

            const stream = await ttsResponse.getStream();
            const reader = stream.getReader();

            while (true) {
                const { done, value } = await reader.read().catch(() => ({}));
                if (done || !value || value.length === 0) break;
                ws.send(value);
            }

            ws.send(JSON.stringify({ type: 'audio_done' }));

            // Save memory
            axios.post(WP_AJAX_URL, new URLSearchParams({
                action: 'save_ai_memory',
                user_msg: userText,
                ai_msg: reply
            })).catch(console.error);

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Server error:', error.message);
                ws.send(JSON.stringify({ type: 'error', message: error.message }));
            }
        }
    });

    ws.on('close', () => console.log('Client disconnected'));
});
