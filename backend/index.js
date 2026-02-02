/**
 * Simple Scribble-like server using Express + Socket.IO
 *
 * In-memory rooms map (reset on restart). Good for demo / local dev.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { nanoid } = require("nanoid");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [CLIENT_ORIGIN],
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 4000;

// Simple word list (expand for production)
const WORDS = [
  "apple","bicycle","computer","guitar","pizza","mountain","elephant",
  "rainbow","airplane","castle","camera","garden","chocolate","piano"
];

// In-memory rooms
// rooms[roomId] = { id, players: [{id, name, socketId, score, hasGuessed}], creatorId, drawerIndex, round: {active, word, startedAt, duration, guesses}}, strokes (optional)
const rooms = {};

// Utility: broadcast room state to all players
function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const publicPlayers = room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    hasGuessed: p.hasGuessed || false,
    isDrawer: room.players[room.drawerIndex]?.id === p.id
  }));
  io.to(roomId).emit("roomState", {
    id: room.id,
    players: publicPlayers,
    round: {
      active: room.round.active,
      startedAt: room.round.startedAt,
      duration: room.round.duration,
      drawerId: room.players[room.drawerIndex]?.id || null,
      wordLength: room.round.active ? room.round.word.length : null,
      revealedWord: room.round.active ? null : room.round.word // reveal when not active (after round end)
    }
  });
}

function startRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.players.length < 2) {
    io.to(roomId).emit("toast", { type: "error", text: "Need at least 2 players to start a round." });
    return;
  }

  // Reset guessed flags
  room.players.forEach(p => {
    p.hasGuessed = false;
  });

  // pick word
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  room.round.word = word;
  room.round.active = true;
  room.round.startedAt = Date.now();
  room.round.duration = 60 * 1000; // 60 seconds per round

  // drawer is room.drawerIndex (current)
  const drawer = room.players[room.drawerIndex];

  // send full word only to drawer
  io.to(drawer.socketId).emit("wordForDrawer", { word });

  // inform others that round started (no revealed word)
  io.to(roomId).emit("roundStarted", {
    drawerId: drawer.id,
    duration: room.round.duration,
    wordLength: word.length
  });

  // send room state
  broadcastRoomState(roomId);

  // schedule end
  if (room.round.timer) clearTimeout(room.round.timer);
  room.round.timer = setTimeout(() => {
    endRound(roomId, null); // time ran out
  }, room.round.duration);
}

function computePoints(room, remainingMs) {
  // Scoring: faster guesses earn more.
  // pointsForGuesser: base 100 + scale with remaining time (max ~600)
  const base = 100;
  const scale = Math.round((remainingMs / room.round.duration) * 600);
  const pointsForGuesser = base + scale;
  const pointsForDrawer = Math.round(pointsForGuesser / 2);
  return { pointsForGuesser, pointsForDrawer };
}

function endRound(roomId, endedByPlayerId) {
  const room = rooms[roomId];
  if (!room || !room.round.active) return;
  room.round.active = false;
  if (room.round.timer) {
    clearTimeout(room.round.timer);
    room.round.timer = null;
  }

  // reveal word to everyone
  io.to(roomId).emit("roundEnded", {
    word: room.round.word,
    endedBy: endedByPlayerId || null
  });

  // move to next drawer
  room.drawerIndex = (room.drawerIndex + 1) % room.players.length;

  // broadcast updated state
  broadcastRoomState(roomId);

  // short delay, then auto-start next round
  setTimeout(() => {
    // only start if still have >=2 players
    if (room && room.players.length >= 2) {
      startRound(roomId);
    }
  }, 3500);
}

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  // Create room + join
  socket.on("createRoom", ({ name }, cb) => {
    const roomId = nanoid(6).toUpperCase();
    const playerId = nanoid(8);
    const room = {
      id: roomId,
      players: [{ id: playerId, name: name || "Host", socketId: socket.id, score: 0, hasGuessed: false }],
      creatorId: playerId,
      drawerIndex: 0,
      round: { active: false, word: null, startedAt: null, duration: 60000, timer: null },
      strokes: []
    };
    rooms[roomId] = room;
    socket.join(roomId);
    socket.data.playerId = playerId;
    socket.data.roomId = roomId;
    socket.data.name = name;

    cb && cb({ ok: true, roomId, playerId });
    broadcastRoomState(roomId);
  });

  // Join existing room
  socket.on("joinRoom", ({ roomId, name }, cb) => {
    const room = rooms[roomId];
    if (!room) {
      cb && cb({ ok: false, error: "Room not found" });
      return;
    }
    const playerId = nanoid(8);
    const player = { id: playerId, name: name || "Player", socketId: socket.id, score: 0, hasGuessed: false };
    room.players.push(player);
    socket.join(roomId);
    socket.data.playerId = playerId;
    socket.data.roomId = roomId;
    socket.data.name = name;

    cb && cb({ ok: true, roomId, playerId });
    io.to(roomId).emit("toast", { type: "info", text: `${player.name} joined the room.` });
    broadcastRoomState(roomId);
  });

  socket.on("leaveRoom", (_, cb) => {
    const { roomId, playerId } = socket.data;
    if (!roomId || !rooms[roomId]) {
      cb && cb({ ok: false });
      return;
    }
    const room = rooms[roomId];
    room.players = room.players.filter(p => p.socketId !== socket.id);
    socket.leave(roomId);
    io.to(roomId).emit("toast", { type: "info", text: `${socket.data.name || "A player"} left.` });

    // if no players left, delete room
    if (room.players.length === 0) {
      if (room.round.timer) clearTimeout(room.round.timer);
      delete rooms[roomId];
    } else {
      // adjust drawerIndex if needed
      room.drawerIndex = room.drawerIndex % room.players.length;
    }

    broadcastRoomState(roomId);
    cb && cb({ ok: true });
  });

  // host can start round manually
  socket.on("startRound", (_, cb) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return cb && cb({ ok: false });
    startRound(roomId);
    cb && cb({ ok: true });
  });

  // real-time strokes; stroke is something like { color, size, points: [{x,y}, ...], isEnd }
  socket.on("stroke", (stroke) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return;
    // keep strokes optionally (to replay for new joiners)
    rooms[roomId].strokes.push(stroke);
    // broadcast to others in room
    socket.to(roomId).emit("stroke", stroke);
  });

  // when a client requests replay of strokes (on join)
  socket.on("requestStrokes", (_, cb) => {
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return cb && cb({ ok: false });
    cb && cb({ ok: true, strokes: rooms[roomId].strokes || [] });
  });

  // chat
  socket.on("chatMessage", ({ text }) => {
    const { roomId, name } = socket.data;
    if (!roomId) return;
    const msg = { id: nanoid(10), from: name || "Anon", text, ts: Date.now() };
    io.to(roomId).emit("chatMessage", msg);
  });

  // guess handling
  socket.on("guess", ({ text }, cb) => {
    const { roomId, playerId, name } = socket.data;
    if (!roomId || !rooms[roomId]) return cb && cb({ ok: false });
    const room = rooms[roomId];
    if (!room.round.active) {
      return cb && cb({ ok: false, error: "No active round" });
    }
    const player = room.players.find(p => p.id === playerId);
    if (!player) return cb && cb({ ok: false });

    // if drawer guesses, ignore
    if (room.players[room.drawerIndex].id === playerId) {
      return cb && cb({ ok: false, error: "Drawer cannot guess" });
    }

    // already guessed
    if (player.hasGuessed) {
      return cb && cb({ ok: false, error: "Already guessed correctly" });
    }

    const guess = (text || "").trim().toLowerCase();
    const word = (room.round.word || "").trim().toLowerCase();

    // broadcast the guess as chat too
    io.to(roomId).emit("chatMessage", { id: nanoid(10), from: player.name, text: guess, ts: Date.now() });

    if (!guess) return cb && cb({ ok: true, correct: false });

    if (guess === word) {
      // correct guess
      const remaining = Math.max(0, room.round.startedAt + room.round.duration - Date.now());
      const { pointsForGuesser, pointsForDrawer } = computePoints(room, remaining);

      player.score += pointsForGuesser;
      // award drawer
      const drawer = room.players[room.drawerIndex];
      if (drawer) drawer.score += pointsForDrawer;

      player.hasGuessed = true;

      io.to(roomId).emit("correctGuess", {
        playerId: player.id,
        name: player.name,
        pointsForGuesser,
        pointsForDrawer
      });

      broadcastRoomState(roomId);

      // check if all non-drawers guessed
      const othersRemaining = room.players.filter(p => p.id !== drawer.id && !p.hasGuessed);
      if (othersRemaining.length === 0) {
        // end round now
        endRound(roomId, player.id);
      }

      return cb && cb({ ok: true, correct: true });
    } else {
      // incorrect - no penalty
      return cb && cb({ ok: true, correct: false });
    }
  });

  socket.on("disconnect", () => {
    console.log("disconnect", socket.id);
    const { roomId } = socket.data;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const left = room.players.filter(p => p.socketId === socket.id)[0];
    room.players = room.players.filter(p => p.socketId !== socket.id);
    io.to(roomId).emit("toast", { type: "info", text: `${left?.name || "A player"} disconnected.` });

    // if no players left, delete room
    if (room.players.length === 0) {
      if (room.round.timer) clearTimeout(room.round.timer);
      delete rooms[roomId];
    } else {
      room.drawerIndex = room.drawerIndex % room.players.length;
      broadcastRoomState(roomId);
    }
  });
});

app.get("/", (req, res) => res.send({ ok: true, message: "Scribble server running" }));

server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});