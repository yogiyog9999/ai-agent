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
    let headerBuffer = []; 

    console.log(`[SESSION ${sessionId}] Connected`);

    dgLive = deepgram.listen.live({
        model: 'nova-3-general',
        language: 'en-US',
        smart_format: true,
        encoding: 'opus', 
        sample_rate: 48000, 
        container: 'webm',
        interim_results: true,
        endpointing: 500, // Detects when you stop talking
    });

    dgLive.on('open', () => {
        dgReady = true;
        // Flush header buffer to ensure Deepgram understands the codec
        headerBuffer.forEach(chunk => dgLive.send(chunk));
        headerBuffer = [];
        console.log(`[SESSION ${sessionId}] Deepgram Ready`);
    });

    dgLive.on('transcript', (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
        
        if (transcript) {
            console.log(`[SESSION ${sessionId}] User: ${transcript}`);
            
            // Send the transcript to the frontend
            ws.send(JSON.stringify({ 
                type: 'text', 
                delta: transcript,
                isFinal: data.is_final // Tell frontend if the sentence is done
            }));
        }
    });

    ws.on('message', (data) => {
        if (!dgReady) {
            headerBuffer.push(data);
        } else if (dgLive.getReadyState() === 1) {
            dgLive.send(data);
        }
    });

    ws.on('close', () => {
        if (dgLive) dgLive.finish();
        console.log(`[SESSION ${sessionId}] Closed`);
    });
});

server.listen(process.env.PORT || 8080, '0.0.0.0', () => {
    console.log('🚀 Server running on port', process.env.PORT || 8080);
});
