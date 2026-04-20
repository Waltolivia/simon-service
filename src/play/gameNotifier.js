const GameEvent = {
  System: 'system',
  End: 'gameEnd',
  Start: 'gameStart',
};

class EventMessage {
  constructor(from, type, value) {
    this.from = from;
    this.type = type;
    this.value = value;
  }
}

class GameEventNotifier {
  handlers = [];
  socket = null;
  isConnected = false;
  reconnecting = false;

  constructor() {
    this.connect();
  }

  connect() {
    if (this.reconnecting && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === 'http:' ? 'ws' : 'wss';
    const host = window.location.host;

    this.socket = new WebSocket(`${protocol}://${host}/ws`);

    this.socket.onopen = () => {
      this.isConnected = true;
      this.reconnecting = false;
      console.log('WebSocket connected');
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      console.log('WebSocket disconnected');

      this.reconnecting = true;
      setTimeout(() => this.connect(), 2000);
    };

    this.socket.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.notifyHandlers(msg);
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    };
  }

  broadcastEvent(from, type, value) {
    const event = new EventMessage(from, type, value);

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }

  addHandler(handler) {
    this.handlers.push(handler);
  }

  removeHandler(handler) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  notifyHandlers(msg) {
    this.handlers.forEach((handler) => handler(msg));
  }
}

const GameNotifier = new GameEventNotifier();

export { GameEvent, GameNotifier };