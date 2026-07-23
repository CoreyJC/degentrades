const express      = require('express');
const tweetService = require('../services/tweetService');

const router = express.Router();

// GET /api/tweets — returns last 50 tweets
router.get('/', (req, res) => {
  res.json(tweetService.getTweets());
});

module.exports = router;
