import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import './styles.css';

// Connect - adjust URL if server runs elsewhere (use environment variable normally)
const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";

const socket = io(SOCKET_URL, { autoConnect: false });

export default function App(){
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [users, setUsers] = useState([]);
  const [room, setRoom] = useState('global');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const msgRef = useRef();

  useEffect(() => {
    // socket events
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('user_list', (data) => setUsers(data));
    socket.on('room_history', ({ room, messages: hist }) => {
      setMessages(hist);
    });
    socket.on('new_message', (m) => {
      setMessages(prev => [...prev, m]);
      // simple sound notification
      try { new Audio('/notification.mp3').play().catch(()=>{}); } catch(e){}
    });
    socket.on('user_typing', ({ username, typing })=>{
      setTypingUsers(prev => ({ ...prev, [username]: typing }));
      setTimeout(()=> {
        // clear stale typing indicators
        setTypingUsers(prev => {
          const copy={...prev};
          if (typing===false) delete copy[username];
          return copy;
        });
      }, 3000);
    });
    socket.on('notification', (n)=> {
      console.log('notification', n);
    });

    return () => {
      socket.off();
    };
  }, []);

  useEffect(()=> {
    // scroll to bottom when messages update
    if (msgRef.current) msgRef.current.scrollTop = msgRef.current.scrollHeight;
  }, [messages]);

  const doLogin = async () => {
    if (!username.trim()) return alert('Enter username');
    socket.connect();
    socket.emit('login', { username }, (res) => {
      if (res && res.success) {
        setLoggedIn(true);
        // join default room
        socket.emit('join_room', { room }, ()=>{});
      } else {
        alert('Login failed: ' + (res && res.error));
      }
    });
  };

  const sendMessage = () => {
    if (!text.trim()) return;
    socket.emit('message', { room, text }, (ack) => {
      // ack contains msgId
      // optimistic UI already updated by server new_message event
    });
    setText('');
    socket.emit('typing', { room, typing: false });
  };

  const handleTyping = (e) => {
    setText(e.target.value);
    socket.emit('typing', { room, typing: true });
    // debounce to stop typing after pause - handled server-side ephemeral
  };

  if (!loggedIn) {
    return (
      <div className="login">
        <h2>Socket.io Chat — Login</h2>
        <input placeholder="Choose a username" value={username} onChange={e=>setUsername(e.target.value)} />
        <button onClick={doLogin}>Join Chat</button>
        <p>Connection: {connected ? 'connected' : 'disconnected'}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h3>Users</h3>
        <ul>
          {users.map(u=> <li key={u.username}>{u.username}{u.online? ' • online':' • offline'}</li>)}
        </ul>
      </aside>
      <main className="chat">
        <div className="messages" ref={msgRef}>
          {messages.map(m => (
            <div key={m.id} className="message">
              <div className="meta"><strong>{m.from}</strong> <span className="ts">{new Date(m.ts).toLocaleTimeString()}</span></div>
              <div className="text">{m.text}</div>
            </div>
          ))}
        </div>
        <div className="typing">
          {Object.entries(typingUsers).filter(([k,v])=>v).map(([k])=> <div key={k}>{k} is typing...</div>)}
        </div>
        <div className="composer">
          <input value={text} onChange={handleTyping} placeholder="Write a message..." onKeyDown={(e)=>{ if (e.key==='Enter') sendMessage(); }} />
          <button onClick={sendMessage}>Send</button>
        </div>
      </main>
    </div>
  );
}
