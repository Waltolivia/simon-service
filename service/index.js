const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const express = require('express');
const uuid = require('uuid');
const http = require('http');

const PeerProxy = require('./peerProxy');

const app = express();

const authCookieName = 'token';

// The scores and users are saved in memory and disappear whenever the service is restarted.
let users = [];
let scores = [];

// The service port
const port = process.argv.length > 2 ? process.argv[2] : 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Router for service endpoints
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

  if (await findUser('email', email)) {
    res.status(409).send({ msg: 'Existing user' });
    return;
  }

  const user = await createUser(email, password);
  setAuthCookie(res, user.token);
  res.send({ email: user.email });
});

// Login
apiRouter.post('/auth/login', async (req, res) => {
  const user = await findUser('email', req.body.email);

  if (user && (await bcrypt.compare(req.body.password, user.password))) {
    user.token = uuid.v4();
    setAuthCookie(res, user.token);
    res.send({ email: user.email });
    return;
  }

  res.status(401).send({ msg: 'Unauthorized' });
});

// Logout
apiRouter.delete('/auth/logout', async (req, res) => {
  const user = await findUser('token', req.cookies[authCookieName]);

  if (user) {
    delete user.token;
  }

  res.clearCookie(authCookieName);
  res.status(204).end();
});

// ---------------- AUTH MIDDLEWARE ----------------

const verifyAuth = async (req, res, next) => {
  const user = await findUser('token', req.cookies[authCookieName]);

  if (user) {
    next();
  } else {
    res.status(401).send({ msg: 'Unauthorized' });
  }
};

// ---------------- SCORES ----------------

// Get scores
apiRouter.get('/scores', verifyAuth, (_req, res) => {
  res.send(scores);
});

// Submit score
apiRouter.post('/score', verifyAuth, (req, res) => {
  scores = updateScores(req.body);
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

// ---------------- HELPER FUNCTIONS ----------------

function updateScores(newScore) {
  let found = false;

  for (const [i, prevScore] of scores.entries()) {
    if (newScore.score > prevScore.score) {
      scores.splice(i, 0, newScore);
      found = true;
      break;
    }
  }

  if (!found) {
    scores.push(newScore);
  }

  if (scores.length > 10) {
    scores.length = 10;
  }

  return scores;
}

async function createUser(email, password) {
  const passwordHash = await bcrypt.hash(password, 10);

  const user = {
    email,
    password: passwordHash,
    token: uuid.v4(),
  };

  users.push(user);
  return user;
}

async function findUser(field, value) {
  if (!value) return null;
  return users.find((u) => u[field] === value);
}

function setAuthCookie(res, authToken) {
  res.cookie(authCookieName, authToken, {
    maxAge: 1000 * 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
  });
}

// ---------------- SERVER SETUP ----------------

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket handling (THIS is the key line)
new PeerProxy(server);

// Start server
server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});