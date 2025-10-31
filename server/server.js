// server.js - Socket.io chat server implementing core + some advanced features
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Simple in-memory stores (for demo / assignment purposes)
const users = {};        // socketId -> { username, socketId, online, currentRoom }
const usernameToSocket = {}; // username -> socketId
const messages = {};     // room -> [ {id, room, from, to, text, ts, read, reactions } ]

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET','POST']
  }
});

// Utility
function timestamp() { return new Date().toISOString(); }
function addMessage(room, msg) {
  messages[room] = messages[room] || [];
  messages[room].push(msg);
  // simple pagination: keep last 1000 messages
  if (messages[room].length > 1000) messages[room].shift();
}

/**
 * Socket events:
 * - login { username } => registers user
 * - join_room { room } => socket joins room
 * - leave_room { room }
 * - message { room, text } => broadcast to room, store, ack
 * - private_message { to, text } => send to specific user
 * - typing { room, typing } => broadcast typing indicator
 * - reaction { room, messageId, reaction } => attach reaction
 * - read_messages { room, messageIds } => mark read
 */
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // Register user
  socket.on('login', (payload, cb) => {
    const username = payload && payload.username ? String(payload.username).trim() : null;
    if (!username) {
      return cb && cb({ success:false, error:'Username required' });
    }
    users[socket.id] = { username, socketId: socket.id, online: true, currentRoom: null };
    usernameToSocket[username] = socket.id;

    // Notify others
    io.emit('user_list', Object.values(users).map(u => ({ username: u.username, online: u.online })));
    io.emit('notification', { type:'user_join', username, ts: timestamp() });

    console.log(`${username} logged in (${socket.id})`);
    cb && cb({ success:true, user: { username, socketId: socket.id } });
  });

  // Join a room
  socket.on('join_room', ({ room }, cb) => {
    room = room || 'global';
    socket.join(room);
    if (users[socket.id]) users[socket.id].currentRoom = room;

    // Send last 50 messages as initial pagination
    const roomMsgs = messages[room] || [];
    const last = roomMsgs.slice(-50);
    socket.emit('room_history', { room, messages: last });

    io.to(room).emit('notification', { type:'join_room', username: users[socket.id]?.username || 'Unknown', room, ts: timestamp() });
    cb && cb({ success:true, room });
  });

  // Leave room
  socket.on('leave_room', ({ room }, cb) => {
    room = room || 'global';
    socket.leave(room);
    if (users[socket.id]) users[socket.id].currentRoom = null;
    io.to(room).emit('notification', { type:'leave_room', username: users[socket.id]?.username || 'Unknown', room, ts: timestamp() });
    cb && cb({ success:true, room });
  });

  // Message to room
  socket.on('message', ({ room, text }, cb) => {
    room = room || 'global';
    const fromUser = users[socket.id]?.username || 'Anonymous';
    const msg = {
      id: socket.id + '::' + Date.now(),
      room,
      from: fromUser,
      text: String(text || ''),
      ts: timestamp(),
      readBy: [],
      reactions: {}
    };
    addMessage(room, msg);
    // broadcast with delivery acknowledgement
    io.to(room).emit('new_message', msg);
    cb && cb({ success:true, msgId: msg.id });
  });

  // Private message
  socket.on('private_message', ({ to, text }, cb) => {
    const fromUser = users[socket.id]?.username || 'Anonymous';
    const toSocket = usernameToSocket[to];
    const pm = {
      id: socket.id + '::pm::' + Date.now(),
      from: fromUser,
      to,
      text: String(text || ''),
      ts: timestamp(),
      read: false
    };
    // store in a pseudo-room for direct messages
    const room = [fromUser, to].sort().join('::pm::');
    addMessage(room, pm);
    // send to recipient if online
    if (toSocket && io.sockets.sockets.get(toSocket)) {
      io.to(toSocket).emit('private_message', pm);
    }
    // also send to sender (for display)
    socket.emit('private_message', pm);
    cb && cb({ success:true, pmId: pm.id });
  });

  // Typing indicator
  socket.on('typing', ({ room, typing }) => {
    room = room || 'global';
    const username = users[socket.id]?.username || 'Anonymous';
    socket.to(room).emit('user_typing', { room, username, typing });
  });

  // Reaction
  socket.on('reaction', ({ room, messageId, reaction }, cb) => {
    const roomMsgs = messages[room] || [];
    const m = roomMsgs.find(x => x.id === messageId);
    if (m) {
      m.reactions[reaction] = (m.reactions[reaction] || 0) + 1;
      io.to(room).emit('message_reaction', { room, messageId, reactions: m.reactions });
      cb && cb({ success:true });
    } else {
      cb && cb({ success:false, error:'Message not found' });
    }
  });

  // Read receipts
  socket.on('read_messages', ({ room, messageIds }, cb) => {
    const roomMsgs = messages[room] || [];
    for (const id of (messageIds||[])) {
      const m = roomMsgs.find(x => x.id === id);
      if (m && !m.readBy.includes(users[socket.id]?.username)) {
        m.readBy.push(users[socket.id]?.username);
      }
    }
    io.to(room).emit('read_receipts', { room, messageIds });
    cb && cb({ success:true });
  });

  // Request online users
  socket.on('get_users', (payload, cb) => {
    cb && cb({ users: Object.values(users).map(u => ({ username: u.username, online: u.online })) });
  });

  socket.on('disconnect', (reason) => {
    const u = users[socket.id];
    if (u) {
      const uname = u.username;
      delete usernameToSocket[uname];
      delete users[socket.id];
      io.emit('user_list', Object.values(users).map(u => ({ username: u.username, online: u.online })));
      io.emit('notification', { type:'user_left', username: uname, ts: timestamp() });
      console.log(`${uname} disconnected`);
    } else {
      console.log('socket disconnected', socket.id, reason);
    }
  });

});


// Simple REST endpoints useful for debugging or grading
app.get('/api/users', (req, res) => {
  res.json(Object.values(users).map(u => ({ username: u.username, online: u.online, currentRoom: u.currentRoom })));
});

app.get('/api/messages/:room', (req, res) => {
  const room = req.params.room || 'global';
  const page = parseInt(req.query.page||'1');
  const pageSize = parseInt(req.query.pageSize||'50');
  const roomMsgs = messages[room] || [];
  // simple pagination (last messages first)
  const start = Math.max(0, roomMsgs.length - page*pageSize);
  const end = Math.max(0, roomMsgs.length - (page-1)*pageSize);
  const pageMsgs = roomMsgs.slice(start, end);
  res.json({ room, page, pageSize, messages: pageMsgs });
});

// root
app.get('/', (req, res) => res.send('Socket.io Chat Server running'));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log('Server listening on', PORT));

module.exports = { app, server, io };
