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

let db;
let userCollection;
let scoreCollection;

// Connect to MongoDB BEFORE handling requests
(async function connectDB() {
  try {
    await client.connect();

    db = client.db('simon');
    userCollection = db.collection('user');
    scoreCollection = db.collection('score');

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

// ---------------- ROUTER ----------------

const apiRouter = express.Router();
app.use('/api', apiRouter);

// ---------------- AUTH ----------------

// Create user
apiRouter.post('/auth/create', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send({ msg: 'Missing email or password' });
  }

  const existingUser = await userCollection.findOne({ email });
  if (existingUser) {
    return res.status(409).send({ msg: 'Existing user' });
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
    const newToken = uuid.v4();

    await userCollection.updateOne(
      { email: user.email },
      { $set: { token: newToken } }
    );

    setAuthCookie(res, newToken);
    res.send({ email: user.email });
    return;
  }

  res.status(401).send({ msg: 'Unauthorized' });
});

// Logout
apiRouter.delete('/auth/logout', async (req, res) => {
  const token = req.cookies[authCookieName];

  if (token) {
    await userCollection.updateOne(
      { token },
      { $unset: { token: 1 } }
    );
  }

  res.clearCookie(authCookieName);
  res.status(204).end();
});

// ---------------- AUTH MIDDLEWARE ----------------

const verifyAuth = async (req, res, next) => {
  const token = req.cookies[authCookieName];

  const user = await userCollection.findOne({ token });

  if (user) {
    next();
  } else {
    res.status(401).send({ msg: 'Unauthorized' });
  }
};

// ---------------- SCORES ----------------

// Get scores
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
  await scoreCollection.insertOne(req.body);

  const scores = await scoreCollection
    .find({})
    .sort({ score: -1 })
    .limit(10)
    .toArray();

  res.send(scores);
});

// ---------------- ERROR HANDLING ----------------

app.use((err, req, res, next) => {
  res.status(500).send({
    type: err.name,
    message: err.message,
  });
});

// ---------------- DEFAULT ROUTE ----------------

app.use((_req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// ---------------- COOKIE HELPER ----------------

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

// WebSocket support (required for Simon DB/service spec)
new PeerProxy(server);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});