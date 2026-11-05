import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:5000";
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export default function App() {
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("general");
  const [joined, setJoined] = useState(false);
  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [callStatus, setCallStatus] = useState("Not in a call");
  const [incomingCall, setIncomingCall] = useState(null);

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: false });
    socketRef.current = socket;

    socket.on("connect", () => setStatus("Connected to NexTalk"));
    socket.on("disconnect", () => {
      setStatus("Disconnected from server");
      setJoined(false);
    });
    socket.on("room-joined", ({ room: joinedRoom }) => {
      setJoined(true);
      setStatus(`Joined room: ${joinedRoom}`);
    });
    socket.on("user-joined", (user) => {
      setPeer(user);
      setMessages((old) => [...old, {
        id: crypto.randomUUID(), system: true, text: `${user.name} joined the room`
      }]);
    });
    socket.on("user-left", (user) => {
      setPeer((current) => current?.socketId === user.socketId ? null : current);
      setMessages((old) => [...old, {
        id: crypto.randomUUID(), system: true, text: `${user.name} left the room`
      }]);
    });
    socket.on("chat-message", (data) => setMessages((old) => [...old, data]));
    socket.on("call-offer", async ({ from, fromName, offer }) => {
      setIncomingCall({ from, fromName, offer });
      setCallStatus(`Incoming call from ${fromName}`);
    });
    socket.on("call-answer", async ({ answer }) => {
      if (!peerRef.current) return;
      await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      for (const candidate of pendingCandidatesRef.current) {
        await peerRef.current.addIceCandidate(candidate);
      }
      pendingCandidatesRef.current = [];
      setCallStatus("Video call connected");
    });
    socket.on("ice-candidate", async ({ candidate }) => {
      if (!candidate || !peerRef.current) return;
      if (peerRef.current.remoteDescription) {
        try { await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (error) { console.error("ICE candidate error:", error); }
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    });
    socket.on("call-ended", () => cleanupCall(false));

    return () => {
      cleanupCall(false);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function joinRoom() {
    if (!name.trim() || !room.trim()) {
      alert("Please enter your name and room name.");
      return;
    }
    const socket = socketRef.current;
    if (!socket.connected) socket.connect();
    socket.emit("join-room", { name: name.trim(), room: room.trim() });
  }

  function sendMessage(event) {
    event.preventDefault();
    if (!message.trim() || !joined) return;
    socketRef.current.emit("chat-message", { text: message });
    setMessage("");
  }

  async function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerRef.current = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", {
          to: targetId, candidate: event.candidate
        });
      }
    };
    pc.ontrack = (event) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (["connected"].includes(pc.connectionState)) setCallStatus("Video call connected");
      if (["failed", "disconnected"].includes(pc.connectionState)) {
        setCallStatus(`Call ${pc.connectionState}`);
      }
    };
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    return pc;
  }

  async function startCall() {
    if (!peer?.socketId) {
      alert("Wait for another person to join this room first.");
      return;
    }
    try {
      setCallStatus("Starting call...");
      const pc = await createPeerConnection(peer.socketId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit("call-offer", { to: peer.socketId, offer });
      setCallStatus(`Calling ${peer.name}...`);
    } catch (error) {
      console.error(error);
      setCallStatus("Could not start call. Check camera/microphone permissions.");
    }
  }

  async function answerCall() {
    if (!incomingCall) return;
    try {
      const pc = await createPeerConnection(incomingCall.from);
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit("call-answer", { to: incomingCall.from, answer });
      setCallStatus("Connecting video call...");
      setIncomingCall(null);
    } catch (error) {
      console.error(error);
      setCallStatus("Could not answer. Check camera/microphone permissions.");
    }
  }

  function cleanupCall(notifyPeer = true) {
    const pc = peerRef.current;
    if (notifyPeer && peer?.socketId) {
      socketRef.current?.emit("call-ended", { to: peer.socketId });
    }
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.close();
    }
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setIncomingCall(null);
    setCallStatus("Not in a call");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">N</div>
        <div><h1>NexTalk</h1><p>Connect instantly. Communicate seamlessly.</p></div>
        <span className="connection">{status}</span>
      </header>

      {!joined ? (
        <section className="join-card">
          <div className="eyebrow">REAL-TIME COMMUNICATION</div>
          <h2>Make conversations happen.</h2>
          <p>Join a room to chat or start a face-to-face call.</p>
          <label>Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your display name" />
          <label>Room name</label>
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. general" />
          <button className="primary full" onClick={joinRoom}>Join room <span>→</span></button>
          <small>Tip: Open another browser tab and join the same room to test.</small>
        </section>
      ) : (
        <div className="workspace">
          <section className="chat-panel">
            <div className="panel-heading">
              <div><span className="live-dot"></span><strong>#{room}</strong><p>Messages appear instantly</p></div>
              <button className="ghost" onClick={() => window.location.reload()}>Leave room</button>
            </div>
          <div className="messages">
            {messages.length === 0 && <div className="empty"><div className="bubble-icon">✦</div><strong>Your conversation starts here</strong><span>Say hello to everyone in the room.</span></div>}
            {messages.map((msg) => msg.system ? (
              <div className="system-message" key={msg.id}>{msg.text}</div>
            ) : (
              <div className={`message ${msg.name === name ? "mine" : ""}`} key={msg.id}>
                <div className="message-meta"><strong>{msg.name}</strong><span>{msg.time}</span></div>
                <div className="message-bubble">{msg.text}</div>
              </div>
            ))}
          </div>
          <form className="message-form" onSubmit={sendMessage}>
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write a message..." />
            <button className="primary" type="submit" disabled={!message.trim()}>Send ↑</button>
          </form>
        </section>

        <aside className="call-panel">
          <div className="panel-heading"><div><strong>Video call</strong><p>{callStatus}</p></div><span className="call-badge">WEBRTC</span></div>
          <div className="video-grid">
            <div className="video-tile remote">
              <video ref={remoteVideoRef} autoPlay playsInline />
              {!remoteVideoRef.current?.srcObject && <div className="video-placeholder"><span>◉</span><small>Other participant</small></div>}
            <span className="video-label">Remote</span>
            </div>
            <div className="video-tile local">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <span className="video-label">You</span>
            </div>
          </div>
          {incomingCall && <div className="incoming"><span>Incoming call from <b>{incomingCall.fromName}</b></span><button className="primary" onClick={answerCall}>Answer call</button></div>}
          <div className="call-actions">
            <button className="primary" onClick={startCall} disabled={!peer?.socketId || !!incomingCall}>Start video call</button>
            <button className="danger" onClick={() => cleanupCall(true)}>Hang up</button>
          </div>
          <div className="participant"><span className="avatar">{peer?.name?.[0]?.toUpperCase() || "?"}</span><div><strong>{peer?.name || "Waiting for participant"}</strong><small>{peer ? "In this room" : "Ask someone to join with the same room name"}</small></div><span className={`presence ${peer ? "online" : ""}`}></span></div>
        <div className="privacy-note">🔒 Video and audio stream peer-to-peer</div>
      </aside>
      </div>
      )}
      <footer>© 2026 NexTalk <span>Built for meaningful connections</span></footer>
    </main>
  );
}
