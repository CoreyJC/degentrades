require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const coinsRoutes = require('./routes/coins');
const tradeRoutes = require('./routes/trade');
const portfolioRoutes = require('./routes/portfolio');
const leaderboardRoutes = require('./routes/leaderboard');
const priceEngine     = require('./services/priceEngine');
const tokenGenerator  = require('./services/tokenGenerator');

const app = express();
const server = http.createServer(app);
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000']
  : ['http://localhost:5173', 'http://localhost:3000'];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/coins', coinsRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));


// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Start price engine — emits updates via socket
priceEngine.start(io);

// Start token generator — spawns new coins every 2-5 min
tokenGenerator.start();

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 DegenTrades backend running on port ${PORT}`);
});
