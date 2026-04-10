const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

let sessionCount = 0;

wss.on('connection', (ws) => {
    const sessionId = ++sessionCount;
    let dgLive;
    let dgReady = false;
    let headerBuffer = []; 

    console.log(`[DEBUG] 👤 Session ${sessionId} connected`);

    // 1. Setup Deepgram with settings matching browser MediaRecorder
    dgLive = deepgram.listen.live({
        model: 'nova-3-general',
        language: 'en-US',
        smart_format: true,
        encoding: 'opus', 
        sample_rate: 48000, 
        container: 'webm', // Critical for browser audio
        interim_results: true,
        endpointing: 1500,
    });

    dgLive.on('open', () => {
        dgReady = true;
        console.log(`[DEBUG] Deepgram 101 SUCCESS - Session ${sessionId}`);
        
        // 2. Flush header buffer once connection is open
        if (headerBuffer.length > 0) {
            headerBuffer.forEach(chunk => dgLive.send(chunk));
            headerBuffer = []; 
        }
    });

    dgLive.on('transcript', (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
        if (transcript) {
            console.log(`[T ${sessionId}] ${transcript}`);
            ws.send(JSON.stringify({ type: 'text', delta: transcript }));
        }
    });

    // 3. Handle data from browser
    ws.on('message', (data) => {
        if (!dgReady) {
            headerBuffer.push(data); // Don't lose the first few seconds
        } else if (dgLive.getReadyState() === 1) {
            dgLive.send(data);
        }
    });

    ws.on('close', () => {
        console.log(`[CLOSE] Session ${sessionId} ended`);
        if (dgLive) dgLive.finish();
    });

    dgLive.on('error', (err) => console.error(`[DG ERROR ${sessionId}]`, err));
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => {
    console.log('🚀 Server active on port', process.env.PORT || 8080);
});
