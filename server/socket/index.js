const { Server } = require('socket.io');
const config = require('../config/config');
const chatController = require('../controllers/chatController');
const messages = require('../models/message');
const users = {};
const usernameToSocket = {};
function createSocketServer(server){ const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });
  io.on('connection', (socket) => {
    console.log('socket connected', socket.id);
    socket.on('login', ({ username }, cb) => {
      if (!username) return cb && cb({ success:false, error:'username required' });
      users[socket.id] = { username, socketId: socket.id, currentRoom: null };
      usernameToSocket[username] = socket.id;
      io.emit('user_list', Object.values(users).map(u=>({ username: u.username })));
      io.emit('notification', { type:'user_join', username, ts: new Date().toISOString() });
      cb && cb({ success:true, user: users[socket.id] });
    });
    socket.on('join_room', ({ room }, cb) => {
      room = room || config.DEFAULT_ROOM;
      socket.join(room);
      if (users[socket.id]) users[socket.id].currentRoom = room;
      const hist = messages.list(room,1,config.MESSAGE_PAGE_SIZE);
      socket.emit('room_history', { room, messages: hist });
      io.to(room).emit('notification', { type:'join_room', username: users[socket.id]?.username, room, ts: new Date().toISOString() });
      cb && cb({ success:true, room });
    });
    socket.on('leave_room', ({ room }, cb) => {
      room = room || config.DEFAULT_ROOM;
      socket.leave(room);
      if (users[socket.id]) users[socket.id].currentRoom = null;
      io.to(room).emit('notification', { type:'leave_room', username: users[socket.id]?.username, room, ts: new Date().toISOString() });
      cb && cb({ success:true });
    });
    socket.on('message', ({ room, text }, cb) => {
      room = room || config.DEFAULT_ROOM;
      const from = users[socket.id]?.username || 'Anonymous';
      const msg = chatController.handleSendMessage({ room, from, text });
      io.to(room).emit('new_message', msg);
      cb && cb({ success:true, id: msg.id });
    });
    socket.on('typing', ({ room, typing }) => {
      room = room || config.DEFAULT_ROOM;
      const username = users[socket.id]?.username || 'Anon';
      socket.to(room).emit('user_typing', { username, typing });
    });
    socket.on('private_message', ({ to, text }, cb) => {
      const from = users[socket.id]?.username;
      const toSocket = usernameToSocket[to];
      const roomKey = [from, to].sort().join('::pm::');
      const pm = { id: 'pm::' + Date.now().toString(), from, to, text, ts: new Date().toISOString() };
      messages.add(roomKey, pm);
      socket.emit('private_message', pm);
      if (toSocket && io.sockets.sockets.get(toSocket)) {
        io.to(toSocket).emit('private_message', pm);
      }
      cb && cb({ success:true });
    });
    socket.on('reaction', ({ room, messageId, reaction }, cb) => {
      const m = messages.find(room, messageId);
      if (m) { m.reactions[reaction] = (m.reactions[reaction]||0)+1; io.to(room).emit('message_reaction', { room, messageId, reactions: m.reactions }); cb && cb({ success:true }); } else cb && cb({ success:false, error:'not found' });
    });
    socket.on('read_messages', ({ room, messageIds }, cb) => {
      const uname = users[socket.id]?.username;
      for (const id of messageIds || []) {
        const m = messages.find(room, id);
        if (m && uname && !m.readBy.includes(uname)) m.readBy.push(uname);
      }
      io.to(room).emit('read_receipts', { room, messageIds });
      cb && cb({ success:true });
    });
    socket.on('get_users', (payload, cb) => { cb && cb({ users: Object.values(users).map(u=>({ username: u.username })) }); });
    socket.on('disconnect', (reason) => {
      const u = users[socket.id];
      if (u) { delete usernameToSocket[u.username]; delete users[socket.id]; io.emit('user_list', Object.values(users).map(u=>({ username: u.username }))); io.emit('notification', { type:'user_left', username: u.username, ts: new Date().toISOString() }); }
      console.log('disconnected', socket.id, reason);
    });
  });
  return io;
}
module.exports = { createSocketServer };