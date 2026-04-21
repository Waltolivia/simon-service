const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const express = require('express');
const uuid = require('uuid');
const http = require('http');
const { MongoClient } = require('mongodb');
const PeerProxy = require('./peerProxy');

const app = express();
const authCookieName = 'token';

// ---------------- SAFE CONFIG ----------------

let config = null;

try {
  config = require('./dbConfig.json');
  console.log('DB config loaded');
} catch {
  console.log('No dbConfig.json → using memory mode');
}

// ---------------- DATABASE ----------------

let dbConnected = false;
let userCollection = null;
let scoreCollection = null;

let users = [];
let scores = [];

let client = null;

async function initDB() {
  if (!config) return;

  try {
    const url = `mongodb+srv://${config.userName}:${config.password}@${config.hostname}`;
    client = new MongoClient(url);

    await client.connect();

    const db = client.db('simon');
    userCollection = db.collection('user');
    scoreCollection = db.collection('score');

    await db.command({ ping: 1 });

    dbConnected = true;
    console.log('MongoDB connected');
  } catch (err) {
    console.log('MongoDB failed → fallback mode');
    console.log(err.message);
    dbConnected = false;
  }
}

initDB();

// ---------------- MIDDLEWARE ----------------

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

const apiRouter = express.Router();
app.use('/api', apiRouter);

// ---------------- AUTH HELPERS ----------------

function setAuthCookie(res, token) {
  res.cookie(authCookieName, token, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
  });
}

function getUserByEmail(email) {
  return dbConnected
    ? userCollection.findOne({ email })
    : users.find((u) => u.email === email);
}

function getUserByToken(token) {
  return dbConnected
    ? userCollection.findOne({ token })
    : users.find((u) => u.token === token);
}

// ---------------- AUTH ----------------

apiRouter.post('/auth/create', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).send({ msg: 'Missing data' });

  const existing = await getUserByEmail(email);
  if (existing) return res.status(409).send({ msg: 'User exists' });

  const user = {
    email,
    password: await bcrypt.hash(password, 10),
    token: uuid.v4(),
  };

  if (dbConnected) {
    await userCollection.insertOne(user);
  } else {
    users.push(user);
  }

  setAuthCookie(res, user.token);
  res.send({ email });
});

apiRouter.post('/auth/login', async (req, res) => {
  const user = await getUserByEmail(req.body.email);

  if (user && (await bcrypt.compare(req.body.password, user.password))) {
    const token = uuid.v4();

    if (dbConnected) {
      await userCollection.updateOne(
        { email: user.email },
        { $set: { token } }
      );
    } else {
      user.token = token;
    }

    setAuthCookie(res, token);
    return res.send({ email: user.email });
  }

  res.status(401).send({ msg: 'Unauthorized' });
});

apiRouter.delete('/auth/logout', async (req, res) => {
  const token = req.cookies[authCookieName];
  const user = await getUserByToken(token);

  if (user && dbConnected) {
    await userCollection.updateOne(
      { email: user.email },
      { $unset: { token: '' } }
    );
  }

  res.clearCookie(authCookieName);
  res.status(204).end();
});

// ---------------- AUTH MIDDLEWARE ----------------

const verifyAuth = async (req, res, next) => {
  const user = await getUserByToken(req.cookies[authCookieName]);
  if (user) return next();
  res.status(401).send({ msg: 'Unauthorized' });
};

// ---------------- SCORES ----------------

apiRouter.get('/scores', verifyAuth, async (_req, res) => {
  if (dbConnected) {
    const result = await scoreCollection
      .find({})
      .sort({ score: -1 })
      .limit(10)
      .toArray();

    return res.send(result);
  }

  res.send(scores);
});

apiRouter.post('/score', verifyAuth, async (req, res) => {
  const newScore = req.body;

  if (dbConnected) {
    await scoreCollection.insertOne(newScore);
  } else {
    scores.push(newScore);
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 10);
  }

  res.send(scores);
});

// ---------------- ERROR HANDLER ----------------

app.use((err, _req, res, _next) => {
  console.error('SERVER ERROR:', err);
  res.status(500).send({ msg: err.message });
});

// ---------------- FRONTEND ----------------

app.use((_req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// ---------------- SERVER ----------------

const server = http.createServer(app);

// SAFE WebSocket init
try {
  new PeerProxy(server);
  console.log('WebSocket initialized');
} catch (e) {
  console.log('WebSocket failed but server continues:', e.message);
}

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});