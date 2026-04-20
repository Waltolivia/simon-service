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

  constructor() {
    const protocol = window.location.protocol === 'http:' ? 'ws' : 'wss';
    this.socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

    // When receiving a message from another client
    this.socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handlers.forEach((handler) => handler(msg));
    };

    this.socket.onopen = () => {
      console.log('WebSocket connected');
    };

    this.socket.onclose = () => {
      console.log('WebSocket disconnected');
    };
  }

  broadcastEvent(from, type, value) {
    const event = new EventMessage(from, type, value);

    // Send to server → server broadcasts to others
    this.socket.send(JSON.stringify(event));
  }

  addHandler(handler) {
    this.handlers.push(handler);
  }

  removeHandler(handler) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }
}

const GameNotifier = new GameEventNotifier();
export { GameEvent, GameNotifier };