import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("NexTalk signaling server is running");
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

io.on("connection", (socket) => {
  socket.on("join-room", ({ room, name }) => {
    if (!room?.trim() || !name?.trim()) return;
    socket.data.room = room.trim();
    socket.data.name = name.trim();
    socket.join(socket.data.room);
    socket.to(socket.data.room).emit("user-joined", {
      socketId: socket.id,
      name: socket.data.name
    });
    socket.emit("room-joined", { room: socket.data.room });
  });

  socket.on("chat-message", (message) => {
    const room = socket.data.room;
    if (!room || !message?.text?.trim()) return;
    io.to(room).emit("chat-message", {
      id: `${Date.now()}-${socket.id}`,
      name: socket.data.name || "Guest",
      text: message.text.trim(),
      time: new Date().toLocaleTimeString()
    });
  });

  // WebRTC signaling: offer, answer and ICE candidates are forwarded to a peer.
  socket.on("call-offer", ({ to, offer }) => io.to(to).emit("call-offer", {
    from: socket.id, fromName: socket.data.name, offer
  }));
  socket.on("call-answer", ({ to, answer }) => io.to(to).emit("call-answer", {
    from: socket.id, answer
  }));
  socket.on("ice-candidate", ({ to, candidate }) => io.to(to).emit("ice-candidate", {
    from: socket.id, candidate
  }));
  socket.on("call-ended", ({ to }) => io.to(to).emit("call-ended", {
    from: socket.id
  }));

  socket.on("disconnect", () => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit("user-left", {
        socketId: socket.id,
        name: socket.data.name
      });
    }
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`NexTalk server running on http://localhost:${PORT}`));
