import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const App = () => {
  const [socket, setSocket] = useState(null);
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('general');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState(['general']);
  const [typingUsers, setTypingUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageOffset, setMessageOffset] = useState(0);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const newSocket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:5000', {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    setSocket(newSocket);

    newSocket.on('connect', () => setIsConnected(true));
    newSocket.on('disconnect', () => setIsConnected(false));

    newSocket.on('receive_message', (msg) => {
      setMessages((prev) => [...prev, msg]);
      setUnreadCount((prev) => prev + 1);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`New message from ${msg.sender}`, { body: msg.content });
      }
    });

    newSocket.on('play_sound', () => {
      new Audio('https://www.soundjay.com/buttons/beep-01a.mp3').play().catch(() => {});
    });

    newSocket.on('typing_users', (users) => setTypingUsers(users));
    newSocket.on('user_list', (userList) => setUsers(userList));
    newSocket.on('room_list', (roomList) => setRooms(roomList));

    newSocket.on('notification', ({ message, id }) => {
      setNotifications((prev) => [...prev, { id, message }]);
      setTimeout(() => setNotifications((prev) => prev.filter(n => n.id !== id)), 5000);
    });

    newSocket.on('receive_messages', (msgs) => {
      setMessages((prev) => [...msgs, ...prev.filter(m => !msgs.find(newMsg => newMsg.id === m.id))]);
    });

    newSocket.on('read_receipt', ({ messageId, readBy }) => {
      setMessages((prev) => prev.map(m => m.id === messageId ? { ...m, readBy } : m));
    });

    newSocket.on('reaction', ({ messageId, username, reaction }) => {
      setMessages((prev) => prev.map(m => m.id === messageId ? {
        ...m,
        reactions: new Map(m.reactions || new Map()).set(username, reaction)
      } : m));
    });

    newSocket.on('search_results', (results) => setMessages(results));

    newSocket.on('user_joined', ({ username }) => {
      setNotifications((prev) => [...prev, { id: Date.now(), message: `${username} joined` }]);
    });

    newSocket.on('user_left', ({ username }) => {
      setNotifications((prev) => [...prev, { id: Date.now(), message: `${username} left` }]);
    });

    return () => newSocket.disconnect();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleJoin = () => {
    if (username && socket) {
      socket.emit('user_join', { username, room });
      if ('Notification' in window) Notification.requestPermission();
      setUnreadCount(0);
    }
  };

  const sendMessage = () => {
    if (message && socket) {
      socket.emit('send_message', { content: message, room });
      setMessage('');
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file && socket) {
      const reader = new FileReader();
      reader.onload = () => {
        socket.emit('send_message', { content: message, room, file: reader.result });
        setMessage('');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTyping = (isTyping) => socket?.emit('typing', { room, isTyping });
  const handleRead = (messageId) => socket?.emit('read_message', { messageId, room });
  const handleReaction = (messageId, reaction) => socket?.emit('reaction', { messageId, room, reaction });
  const joinRoom = (newRoom) => {
    if (newRoom) {
      setRoom(newRoom);
      socket?.emit('join_room', { room: newRoom });
      setMessages([]);
      setMessageOffset(0);
    }
  };

  const loadMoreMessages = () => {
    setMessageOffset((prev) => prev + 20);
    socket?.emit('load_more', { room, offset: messageOffset + 20 });
  };

  const searchMessages = () => socket?.emit('search_messages', { query: searchQuery, room });

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <h1 className="text-2xl mb-4">Connecting...</h1>
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (!username) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h1 className="text-2xl mb-4">Enter Username</h1>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="border p-2 mb-4 w-full"
            placeholder="Your username"
          />
          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="border p-2 mb-4 w-full"
          >
            {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={handleJoin}
            className="bg-blue-500 text-white p-2 rounded w-full"
          >
            Join Chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans">
      <div className="bg-blue-500 text-white p-4 flex justify-between items-center">
        <h1 className="text-xl">Chat App - {username} ({room})</h1>
        <span className="text-sm">Unread: {unreadCount}</span>
      </div>
      <div className="flex-1 flex flex-col md:flex-row">
        <div className="w-full md:w-1/4 bg-white p-4 border-r">
          <h2 className="text-lg mb-2">Users & Rooms</h2>
          <select
            value={room}
            onChange={(e) => joinRoom(e.target.value)}
            className="border p-2 w-full mb-4"
          >
            {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
            <option value="">New Room</option>
          </select>
          <input
            type="text"
            placeholder="New room name"
            onKeyPress={(e) => e.key === 'Enter' && joinRoom(e.target.value)}
            className="border p-2 w-full mb-4"
          />
          <select
            onChange={(e) => e.target.value && socket?.emit('private_message', { toUsername: e.target.value, content: '' })}
            className="border p-2 w-full mb-4"
          >
            <option value="">Send Private Message</option>
            {users.map(([id, user]) => user.username !== username && (
              <option key={id} value={user.username}>{user.username} {user.online ? '(Online)' : '(Offline)'}</option>
            ))}
          </select>
          {users.map(([id, user]) => (
            <div key={id} className="text-sm">{user.username} {user.online ? '(Online)' : '(Offline)'}</div>
          ))}
        </div>
        <div className="flex-1 flex flex-col">
          <div className="p-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchMessages()}
              className="border p-2 w-full mb-4"
              placeholder="Search messages..."
            />
            <button
              onClick={loadMoreMessages}
              className="bg-gray-200 p-2 rounded mb-4"
            >
              Load More
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`mb-2 ${msg.sender === username ? 'text-right' : 'text-left'}`}
                onClick={() => handleRead(msg.id)}
              >
                <div
                  className={`inline-block p-2 rounded-lg ${
                    msg.sender === username ? 'bg-blue-100' : 'bg-gray-200'
                  }`}
                >
                  <strong>{msg.sender}: </strong>
                  {msg.content}
                  {msg.file && (
                    <div>
                      <a href={msg.file} download>
                        <img src={msg.file} alt="Shared file" className="max-w-xs mt-2" />
                      </a>
                    </div>
                  )}
                  <div className="text-xs text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                    {msg.readBy?.size > 1 && ` (Read by ${msg.readBy.size - 1})`}
                  </div>
                  <div className="flex gap-2 mt-1">
                    {['👍', '❤️', '😂'].map((r) => (
                      <button
                        key={r}
                        onClick={() => handleReaction(msg.id, r)}
                        className="text-sm"
                      >
                        {r} {msg.reactions?.get(username) === r ? '✓' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {typingUsers.length > 0 && (
              <div className="text-gray-500 italic">{typingUsers.join(', ')} typing...</div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="p-4 bg-white border-t">
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  handleTyping(true);
                }}
                onBlur={() => handleTyping(false)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                className="flex-1 border p-2 rounded"
                placeholder="Type a message..."
              />
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current.click()}
                className="bg-gray-500 text-white p-2 rounded"
              >
                📎
              </button>
              <button
                onClick={sendMessage}
                className="bg-blue-500 text-white p-2 rounded"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="fixed bottom-4 right-4">
        {notifications.map((n) => (
          <div key={n.id} className="bg-yellow-100 p-2 rounded mb-2 shadow">
            {n.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;