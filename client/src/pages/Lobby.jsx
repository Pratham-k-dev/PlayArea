import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket";

export default function Lobby() {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const navigate = useNavigate();

  // create room: call socket.createRoom then navigate
  async function createRoom() {
    if (!name.trim()) return alert("Enter your name");
    socket.connect();
    socket.emit("createRoom", { name }, (res) => {
      if (res?.ok) {
        navigate(`/room/${res.roomId}`, { state: { name, playerId: res.playerId } });
      } else {
        alert("Failed to create room");
      }
    });
  }

  function joinRoom() {
    if (!name.trim()) return alert("Enter your name");
    if (!roomId.trim()) return alert("Enter room ID");
    socket.connect();
    socket.emit("joinRoom", { roomId: roomId.trim().toUpperCase(), name }, (res) => {
      if (res?.ok) {
        navigate(`/room/${roomId.trim().toUpperCase()}`, { state: { name, playerId: res.playerId } });
      } else {
        alert(res?.error || "Failed to join");
      }
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-slate-900 rounded-2xl p-6 shadow-lg">
        <h1 className="text-2xl font-semibold mb-2">Play Area — Scribble</h1>
        <p className="text-sm text-slate-400 mb-4">Create or join a room to play. Dark mode UI.</p>

        <label className="block text-sm text-slate-300">Your name</label>
        <input value={name} onChange={(e)=>setName(e.target.value)} className="mt-2 w-full bg-slate-800 text-slate-100 rounded-md px-4 py-2" placeholder="Display name" />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button onClick={createRoom} className="py-2 bg-indigo-600 rounded-md text-white">Create room</button>
          <div>
            <label className="text-xs text-slate-400">Room ID</label>
            <input value={roomId} onChange={(e)=>setRoomId(e.target.value)} className="mt-1 w-full bg-slate-800 text-slate-100 rounded-md px-3 py-2" placeholder="AB12CD" />
            <button onClick={joinRoom} className="mt-2 w-full py-2 bg-emerald-600 rounded-md text-white">Join room</button>
          </div>
        </div>

        <div className="mt-4 text-sm text-slate-500">
          Note: this demo stores rooms in server memory (reset on server restart).
        </div>
      </div>
    </div>
  );
}