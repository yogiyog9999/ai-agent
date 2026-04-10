require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

let sessionCount = 0;

wss.on('connection', (ws) => {
    const sessionId = ++sessionCount;
    let dgLive;
    let dgReady = false;
    let chunksReceived = 0;
    let totalBytes = 0;

    console.log(`\n[SESSION ${sessionId}] 👤 New client connected`);

    dgLive = deepgram.listen.live({
        model: 'nova-3-general',
        language: 'en-US',
        smart_format: true,
        encoding: 'opus', 
        sample_rate: 48000, 
        container: 'webm',
        interim_results: true,
        utterance_end_ms: 1000,
        endpointing: 500,
    });

    dgLive.on('open', () => {
        dgReady = true;
        console.log(`[SESSION ${sessionId}] ✅ Deepgram 101 SUCCESS (Handshake complete)`);
    });

    dgLive.on('transcript', (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
        if (transcript) {
            console.log(`[SESSION ${sessionId}] 📝 TRANSCRIPT: "${transcript}"`);
            ws.send(JSON.stringify({ type: 'text', delta: transcript }));
        } else {
            // Log empty transcripts to see if Deepgram is at least "listening"
            console.log(`[SESSION ${sessionId}] 👂 Deepgram processed a chunk but found no words.`);
        }
    });

    dgLive.on('metadata', (data) => console.log(`[SESSION ${sessionId}] ℹ️ Metadata:`, JSON.stringify(data)));
    
    ws.on('message', (data) => {
        chunksReceived++;
        totalBytes += data.length;

        // Log every 10th chunk to avoid flooding Railway logs, but prove data is moving
        if (chunksReceived % 10 === 0) {
            console.log(`[SESSION ${sessionId}] 📦 Audio Flow: Received ${chunksReceived} chunks (${totalBytes} total bytes)`);
        }

        if (dgReady && dgLive.getReadyState() === 1) {
            dgLive.send(data);
        }
    });

    dgLive.on('error', (err) => {
        console.error(`[SESSION ${sessionId}] ❌ DEEPGRAM ERROR:`, err);
        ws.send(JSON.stringify({ type: 'error', message: 'Deepgram connection error' }));
    });

    ws.on('close', () => {
        console.log(`[SESSION ${sessionId}] 🚪 Client disconnected. Total Chunks: ${chunksReceived}`);
        if (dgLive) dgLive.finish();
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DEBUG SERVER LIVE ON PORT ${PORT}`);
});
