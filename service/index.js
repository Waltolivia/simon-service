const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const express = require('express');
const uuid = require('uuid');
const http = require('http');
const { MongoClient } = require('mongodb');

const PeerProxy = require('./peerProxy');

// dbConfig may or may not exist in production depending on deploy setup
let config = {};
try {
  config = require('./dbConfig.json');
} catch (e) {
  console.log('dbConfig.json not found — running in fallback mode (memory only)');
}

const app = express();
const authCookieName = 'token';

// ---------------- SAFE DB SETUP ----------------

let userCollection = null;
let scoreCollection = null;
let dbConnected = false;

const url =
  config.userName && config.password && config.hostname
    ? `mongodb+srv://${config.userName}:${config.password}@${config.hostname}`
    : null;

const client = url ? new MongoClient(url) : null;

// fallback memory storage
let users = [];
let scores = [];

// connect DB (non-fatal)
async function initDB() {
  if (!client) {
    console.log('No MongoDB config found — using in-memory storage');
    return;
  }

  try {
    await client.connect();

    const db = client.db('simon');
    userCollection = db.collection('user');
    scoreCollection = db.collection('score');

    await db.command({ ping: 1 });

    dbConnected = true;
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.log('⚠️ MongoDB connection failed — switching to memory mode');
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

async function findUserByEmail(email) {
  if (dbConnected) return userCollection.findOne({ email });
  return users.find((u) => u.email === email);
}

async function findUserByToken(token) {
  if (dbConnected) return userCollection.findOne({ token });
  return users.find((u) => u.token === token);
}

// ---------------- AUTH ROUTES ----------------

// Create
apiRouter.post('/auth/create', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send({ msg: 'Missing email or password' });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return res.status(409).send({ msg: 'Existing user' });
  }

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

// Login
apiRouter.post('/auth/login', async (req, res) => {
  const user = await findUserByEmail(req.body.email);

  if (user && (await bcrypt.compare(req.body.password, user.password))) {
    const newToken = uuid.v4();

    if (dbConnected) {
      await userCollection.updateOne(
        { email: user.email },
        { $set: { token: newToken } }
      );
    } else {
      user.token = newToken;
    }

    setAuthCookie(res, newToken);
    return res.send({ email: user.email });
  }

  res.status(401).send({ msg: 'Unauthorized' });
});

// Logout
apiRouter.delete('/auth/logout', async (req, res) => {
  const token = req.cookies[authCookieName];
  const user = await findUserByToken(token);

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
  const user = await findUserByToken(req.cookies[authCookieName]);
  if (user) return next();

  res.status(401).send({ msg: 'Unauthorized' });
};

// ---------------- SCORES ----------------

// Get scores
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

// Submit score
apiRouter.post('/score', verifyAuth, async (req, res) => {
  const newScore = req.body;

  if (dbConnected) {
    await scoreCollection.insertOne(newScore);

    const result = await scoreCollection
      .find({})
      .sort({ score: -1 })
      .limit(10)
      .toArray();

    return res.send(result);
  }

  scores.push(newScore);
  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, 10);

  res.send(scores);
});

// ---------------- ERROR HANDLER ----------------

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send({ msg: 'Server error', error: err.message });
});

// ---------------- FRONTEND ----------------

app.use((_req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// ---------------- SERVER ----------------

const server = http.createServer(app);

// WebSocket (required for assignment)
new PeerProxy(server);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});