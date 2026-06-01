const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const server = express().listen(PORT, () => {
  console.log(`Relay server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('New client connected to cloud relay');

  ws.on('message', (message) => {
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) { 
        try {
          client.send(message.toString());
        } catch (err) {
          console.error('Error sending message to client:', err.message);
        }
      }
    });
  });

  ws.on('close', () => console.log('Client disconnected from cloud relay'));
});
