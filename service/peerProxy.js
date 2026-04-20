const { WebSocketServer } = require('ws');

class PeerProxy {
  constructor(server) {
    this.connections = [];

    this.wss = new WebSocketServer({ noServer: true });

    // Handle HTTP → WebSocket upgrade
    server.on('upgrade', (request, socket, head) => {
      if (request.url.startsWith('/ws')) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    // Handle new connections
    this.wss.on('connection', (ws) => {
      ws.isAlive = true;
      this.connections.push(ws);

      // Keep connection alive
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle messages
      ws.on('message', (message) => {
        this.broadcast(ws, message);
      });

      // Remove closed connections
      ws.on('close', () => {
        this.connections = this.connections.filter((c) => c !== ws);
      });
    });

    // Ping clients every 10 seconds
    setInterval(() => {
      this.connections.forEach((ws) => {
        if (!ws.isAlive) {
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 10000);
  }

  // Send message to all other clients
  broadcast(sender, message) {
    this.connections.forEach((conn) => {
      if (conn !== sender && conn.readyState === 1) {
        conn.send(message.toString());
      }
    });
  }
}

module.exports = PeerProxy;