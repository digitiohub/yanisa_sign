const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('path');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const signRoutes = require('./routes/sign');
const { initStorage } = require('./services/storage');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: isProduction && !process.env.CLIENT_URL
    ? false
    : (process.env.CLIENT_URL || 'http://localhost:5173'),
  credentials: true,
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Sign service ready', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
  const email = String(req.body.email || '').toLowerCase();
  const password = String(req.body.password || '');
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || email !== process.env.ADMIN_EMAIL.toLowerCase() || password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: jwt.sign({ sub: email, email, role: 'hr_admin' }, process.env.JWT_SECRET, { expiresIn: '8h' }), user: { email, role: 'hr_admin' } });
});

app.use('/api/sign', signRoutes);

if (isProduction) {
  const clientPath = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientPath, { maxAge: '1y', immutable: true }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(clientPath, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  console.error(err.message);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  res.status(err.status || 500).json({ error: isProduction ? 'An unexpected error occurred' : err.message });
});

async function start() {
  try {
    if (process.env.MONGO_URI) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log('MongoDB connected');
    }
    await initStorage();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Application startup failed', err);
    process.exit(1);
  }
}

if (require.main === module) start();
module.exports = { app, start };
