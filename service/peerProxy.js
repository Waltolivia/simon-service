const { WebSocketServer } = require('ws');

class PeerProxy {
  constructor(server) {
    this.connections = [];
    this.wss = new WebSocketServer({ noServer: true });

    // Handle upgrade
    server.on('upgrade', (request, socket, head) => {
      if (request.url.startsWith('/ws')) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    // Connection handler
    this.wss.on('connection', (ws) => {
      ws.isAlive = true;
      this.connections.push(ws);

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message) => {
        this.broadcast(ws, message);
      });

      ws.on('close', () => {
        this.connections = this.connections.filter((c) => c !== ws);
      });
    });

    // Heartbeat cleanup
    this.interval = setInterval(() => {
      this.connections.forEach((ws) => {
        if (!ws.isAlive) {
          ws.terminate();
          return;
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 10000);
  }

  broadcast(sender, message) {
    this.connections.forEach((conn) => {
      if (conn !== sender && conn.readyState === 1) {
        conn.send(message.toString());
      }
    });
  }
}

module.exports = PeerProxy;