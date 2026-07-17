# 🎰 DegenTrades

Multiplayer memecoin trading simulator. 100 SOL to start. Prices update every 2 seconds. New tokens spawn every 30 seconds. Everything can rug at any time.

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | React 19 + Vite 8 + Tailwind v4 + lightweight-charts |
| Backend  | Node.js + Express + Socket.io |
| DB       | PostgreSQL + Prisma ORM |
| Realtime | WebSocket (socket.io) |

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL running locally (or change `DATABASE_URL`)

### Backend

```bash
cd backend
cp .env.example .env        # edit DATABASE_URL + JWT_SECRET
npm install
npx prisma migrate dev --name init
node src/seed.js            # seeds 5 starting coins
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## Architecture

### Price Engine (`src/services/priceEngine.js`)

Ticks every **2 seconds**. Per tick, each coin rolls:

| Outcome   | Probability | Effect |
|-----------|-------------|--------|
| Normal    | ~85%        | ±1–5% random walk |
| Mini pump | 8%          | +10–25% |
| Mini dump | 5%          | -10–20% |
| Mega pump | 1%          | +50–200% |
| Rug pull  | 0.5–1% base | -80–99% → deletion if price ≤ $0.0000001 |

**Age-based rug multiplier** scales the rug probability:
- `< 5 min` → ×0.2 (honeymoon protection)
- `5–20 min` → ×1.0 (normal)
- `> 20 min` → ×(1.0 + 0.1 × extra minutes) — ticking time bomb

### Token Generator (`src/services/tokenGenerator.js`)

Spawns **1 new coin every 30 seconds** with:
- Random name (Adjective + Noun + Suffix word bank)
- Random ticker derived from capital letters of the name
- Log-uniform starting price between `$0.000001` and `$0.01`
- Per-coin rug probability between 0.5% and 1% per tick

### Rug Sequence

When price drops to or below `$0.0000001`:
1. Coin marked `isActive: false` in DB
2. `coin_deleted` Socket.io event emitted to all clients
3. All holdings deleted (users lose their bags 💀)
4. Coin hard-deleted from DB

### Socket.io Events

| Event          | Direction      | Payload |
|----------------|----------------|---------|
| `price_update` | server → client | `{ [coinId]: { id, price, candle } }` |
| `coin_added`   | server → client | `{ id, name, ticker, currentPrice, ... }` |
| `coin_deleted` | server → client | `{ coinId, name, ticker, finalPrice }` |

---

## Project Structure

```
degentrades/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       ├── index.js
│       ├── seed.js
│       ├── lib/prisma.js
│       ├── middleware/auth.js
│       ├── routes/
│       │   ├── auth.js
│       │   ├── coins.js
│       │   ├── trade.js
│       │   ├── portfolio.js
│       │   └── leaderboard.js
│       └── services/
│           ├── priceEngine.js
│           └── tokenGenerator.js
└── frontend/
    └── src/
        ├── App.jsx
        ├── context/
        │   ├── AuthContext.jsx
        │   ├── SocketContext.jsx
        │   └── ToastContext.jsx
        ├── hooks/
        │   └── useCoins.js
        ├── pages/
        │   ├── Market.jsx
        │   ├── CoinDetail.jsx
        │   ├── Portfolio.jsx
        │   ├── Leaderboard.jsx
        │   ├── Login.jsx
        │   └── Register.jsx
        └── components/
            └── Nav.jsx
```
