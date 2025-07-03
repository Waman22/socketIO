// Load environment variables
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  },
  maxHttpBufferSize: 1e7 // 10MB for file sharing (Task 3)
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data structures
const users = new Map(); // { socketId: { username, rooms: Set, online: boolean } }
const messages = new Map(); // { room: [{ id, sender, senderId, content, timestamp, file, readBy: Set, reactions: Map }] }
const rooms = new Set(['general']); // Available rooms
const typingUsers = new Map(); // { room: Set<username> }

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Task 2: User authentication (username-based) and join room
  socket.on('user_join', ({ username, room = 'general' }) => {
    if (!users.has(socket.id)) {
      users.set(socket.id, { username, rooms: new Set([room]), online: true });
      socket.join(room);
      if (!messages.has(room)) messages.set(room, []);
      if (!rooms.has(room)) rooms.add(room);

      // Send initial messages for the room
      socket.emit('receive_messages', messages.get(room));
      // Update user list and rooms
      io.emit('user_list', Array.from(users.entries()));
      io.emit('room_list', Array.from(rooms));
      // Task 4: Notify room of user joining
      io.to(room).emit('notification', { message: `${username} joined ${room}`, id: Date.now() });
      console.log(`${username} joined ${room}`);
    }
  });

  // Task 2 & 3: Handle global and private messages
  socket.on('send_message', ({ content, room = 'general', file }) => {
    const message = {
      id: Date.now(),
      sender: users.get(socket.id)?.username || 'Anonymous',
      senderId: socket.id,
      content,
      timestamp: new Date().toISOString(),
      file: file || null,
      readBy: new Set([socket.id]), // Task 3: Read receipts
      reactions: new Map() // Task 3: Message reactions
    };

    if (!messages.has(room)) messages.set(room, []);
    messages.get(room).push(message);

    // Task 5: Limit messages for performance (pagination support)
    if (messages.get(room).length > 200) messages.get(room).shift();

    // Broadcast message to room or specific user
    if (room.startsWith('private_')) {
      const recipientId = room.split('_')[1];
      socket.to(recipientId).emit('receive_message', message);
      socket.emit('receive_message', message); // Echo to sender
    } else {
      io.to(room).emit('receive_message', message);
    }

    // Task 5: Delivery acknowledgment
    socket.emit('ack', { id: message.id });

    // Task 4: New message notification
    socket.to(room).emit('notification', {
      message: `${message.sender}: ${message.content.slice(0, 20)}${message.content.length > 20 ? '...' : ''}`,
      id: Date.now()
    });

    // Task 4: Sound notification
    socket.to(room).emit('play_sound');
  });

  // Task 2 & 3: Typing indicator
  socket.on('typing', ({ room = 'general', isTyping }) => {
    if (users.get(socket.id)) {
      const username = users.get(socket.id).username;
      if (!typingUsers.has(room)) typingUsers.set(room, new Set());

      if (isTyping) {
        typingUsers.get(room).add(username);
      } else {
        typingUsers.get(room).delete(username);
      }

      io.to(room).emit('typing_users', Array.from(typingUsers.get(room) || []));
    }
  });

  // Task 3: Private messaging
  socket.on('private_message', ({ toUsername, content, file }) => {
    const recipient = Array.from(users.entries()).find(
      ([, user]) => user.username === toUsername
    );
    if (recipient) {
      const room = `private_${recipient[0]}`;
      socket.emit('send_message', { content, room, file });
    }
  });

  // Task 3: Join new room
  socket.on('join_room', ({ room }) => {
    if (!rooms.has(room)) rooms.add(room);
    users.get(socket.id)?.rooms.add(room);
    socket.join(room);
    if (!messages.has(room)) messages.set(room, []);
    socket.emit('receive_messages', messages.get(room));
    io.emit('room_list', Array.from(rooms));
    io.to(room).emit('notification', {
      message: `${users.get(socket.id)?.username} joined ${room}`,
      id: Date.now()
    });
  });

  // Task 3: Read receipts
  socket.on('read_message', ({ messageId, room }) => {
    const msg = messages.get(room)?.find(m => m.id === messageId);
    if (msg) {
      msg.readBy.add(socket.id);
      io.to(room).emit('read_receipt', { messageId, readBy: Array.from(msg.readBy) });
    }
  });

  // Task 3: Message reactions
  socket.on('reaction', ({ messageId, room, reaction }) => {
    const msg = messages.get(room)?.find(m => m.id === messageId);
    if (msg) {
      msg.reactions.set(users.get(socket.id).username, reaction);
      io.to(room).emit('reaction', { messageId, username: users.get(socket.id).username, reaction });
    }
  });

  // Task 5: Message search
  socket.on('search_messages', ({ query, room }) => {
    const results = messages.get(room)?.filter(m =>
      m.content.toLowerCase().includes(query.toLowerCase())
    ) || [];
    socket.emit('search_results', results);
  });

  // Task 5: Message pagination
  socket.on('load_more', ({ room, offset }) => {
    const roomMessages = messages.get(room) || [];
    const pageSize = 20;
    const paginated = roomMessages.slice(
      Math.max(roomMessages.length - offset - pageSize, 0),
      roomMessages.length - offset
    );
    socket.emit('receive_messages', paginated);
  });

  // Task 2 & 4: Handle disconnection
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      user.rooms.forEach(room => {
        io.to(room).emit('notification', {
          message: `${user.username} left ${room}`,
          id: Date.now()
        });
        io.to(room).emit('user_left', { username: user.username, id: socket.id });
      });
      users.delete(socket.id);
      rooms.forEach(room => typingUsers.get(room)?.delete(user.username));
      io.emit('user_list', Array.from(users.entries()));
      io.emit('typing_users', Array.from(typingUsers.get('general') || []));
      console.log(`${user.username} disconnected`);
    }
  });
});

// API routes for message and user history
app.get('/api/messages', (req, res) => {
  const room = req.query.room || 'general';
  res.json(messages.get(room) || []);
});

app.get('/api/users', (req, res) => {
  res.json(Array.from(users.entries()));
});

app.get('/api/rooms', (req, res) => {
  res.json(Array.from(rooms));
});

// Root route
app.get('/', (req, res) => {
  res.send('Socket.io Chat Server is running');
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server, io };