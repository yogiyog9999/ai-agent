const WebSocket = require('ws');
const OpenAI = require('openai');
const { createClient } = require('@deepgram/sdk');
const axios = require('axios');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const WP_AJAX_URL = 'https://cipr.nestingstage.com/wp-admin/admin-ajax.php';

function getWavHeader(dataLength) {
    const buffer = Buffer.alloc(44);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(24000, 24);
    buffer.writeUInt32LE(24000 * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
}

wss.on('connection', (ws) => {
    let currentAbortController = null;
    let isInterrupted = false;
    let activeSessionId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'interrupt') {
                if (data.sessionId && activeSessionId && data.sessionId !== activeSessionId) return;
                isInterrupted = true;
                if (currentAbortController) currentAbortController.abort();
                return;
            }

            isInterrupted = false;
            activeSessionId = data.sessionId || Date.now().toString();
            currentAbortController = new AbortController();

            const userText = data.text;

            const wpResponse = await axios.post(
                WP_AJAX_URL,
                new URLSearchParams({
                    action: 'get_veronica_context',
                    message: userText
                })
            ).catch(() => ({ data: { global_prompt: 'You are Veronica.', context: '', history: [] } }));

            const { context, global_prompt, history } = wpResponse.data || {};

            if (isInterrupted) return;

            const messages = [
                {
                    role: 'system',
                    content: `${global_prompt || 'You are Veronica.'} ROLE: Veronica. BREVITY: Max 20 words. CONTEXT: ${context || ''}`
                },
                ...(Array.isArray(history) ? history : []),
                { role: 'user', content: userText === 'GENERATE_WELCOME_GREETING' ? 'Hello' : userText }
            ];

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages,
                temperature: 0.6
            }, { signal: currentAbortController.signal });

            const replyText = completion.choices[0].message.content || '';
            ws.send(JSON.stringify({ type: 'text', content: replyText, sessionId: activeSessionId }));

            const response = await deepgram.speak.request(
                { text: replyText },
                {
                    model: 'aura-asteria-en',
                    encoding: 'linear16',
                    container: 'none',
                    sample_rate: 24000,
                    prosody: { speed: 1.0 }
                }
            );

            const stream = await response.getStream();
            const reader = stream.getReader();

            while (true) {
                if (isInterrupted) break;
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.length) {
                    ws.send(value);
                }
            }

            ws.send(JSON.stringify({ type: 'audio_done', sessionId: activeSessionId }));

            if (!isInterrupted) {
                axios.post(
                    WP_AJAX_URL,
                    new URLSearchParams({
                        action: 'save_ai_memory',
                        user_msg: userText,
                        ai_msg: replyText
                    })
                ).catch(() => {});
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error:', error.message);
            }
        }
    });
});
