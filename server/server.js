// server.js - main server file
const express = require('express');
const http = require('http');
const cors = require('cors');
const { createSocketServer } = require('./socket');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, '..', 'client', 'public')));
const server = http.createServer(app);
const io = createSocketServer(server);
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = { app, server, io };
