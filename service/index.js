const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const express = require('express');
const uuid = require('uuid');
const http = require('http');
const { MongoClient } = require('mongodb');

const PeerProxy = require('./peerProxy');
const config = require('./dbConfig.json');

const app = express();
const authCookieName = 'token';

// ---------------- DATABASE SETUP ----------------

const url = `mongodb+srv://${config.userName}:${config.password}@${config.hostname}`;
const client = new MongoClient(url);
const db = client.db('simon');

const userCollection = db.collection('user');
const scoreCollection = db.collection('score');

// Test DB connection
(async function testConnection() {
  try {
    await db.command({ ping: 1 });
    console.log('Connected to MongoDB');
  } catch (e) {
    console.log(`DB connection failed: ${e.message}`);
    process.exit(1);
  }
})();

// ---------------- MIDDLEWARE ----------------

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Router
const apiRouter = express.Router();
app.use('/api', apiRouter);

// ---------------- AUTH ----------------

// Create user
apiRouter.post('/auth/create', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).send({ msg: 'Missing email or password' });
    return;
  }

  const existingUser = await userCollection.findOne({ email });
  if (existingUser) {
    res.status(409).send({ msg: 'Existing user' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    email,
    password: passwordHash,
    token: uuid.v4(),
  };

  await userCollection.insertOne(user);

  setAuthCookie(res, user.token);
  res.send({ email: user.email });
});

// Login
apiRouter.post('/auth/login', async (req, res) => {
  const user = await userCollection.findOne({ email: req.body.email });

  if (user && (await bcrypt.compare(req.body.password, user.password))) {
    user.token = uuid.v4();
    await userCollection.updateOne(
      { email: user.email },
      { $set: { token: user.token } }
    );

    setAuthCookie(res, user.token);
    res.send({ email: user.email });
    return;
  }

  res.status(401).send({ msg: 'Unauthorized' });
});

// Logout
apiRouter.delete('/auth/logout', async (req, res) => {
  const token = req.cookies[authCookieName];

  const user = await userCollection.findOne({ token });

  if (user) {
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
  const user = await userCollection.findOne({
    token: req.cookies[authCookieName],
  });

  if (user) {
    next();
  } else {
    res.status(401).send({ msg: 'Unauthorized' });
  }
};

// ---------------- SCORES ----------------

// Get high scores
apiRouter.get('/scores', verifyAuth, async (_req, res) => {
  const scores = await scoreCollection
    .find({})
    .sort({ score: -1 })
    .limit(10)
    .toArray();

  res.send(scores);
});

// Submit score
apiRouter.post('/score', verifyAuth, async (req, res) => {
  const newScore = req.body;

  await scoreCollection.insertOne(newScore);

  const scores = await scoreCollection
    .find({})
    .sort({ score: -1 })
    .limit(10)
    .toArray();

  res.send(scores);
});

// ---------------- ERROR HANDLING ----------------

app.use((err, req, res, next) => {
  res.status(500).send({ type: err.name, message: err.message });
});

// Default route
app.use((_req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// ---------------- COOKIE ----------------

function setAuthCookie(res, authToken) {
  res.cookie(authCookieName, authToken, {
    maxAge: 1000 * 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
  });
}

// ---------------- SERVER ----------------

const server = http.createServer(app);

// WebSocket support (UNCHANGED requirement)
new PeerProxy(server);

server.listen(process.env.PORT || 3000, () => {
  console.log(`Listening on port ${process.env.PORT || 3000}`);
});