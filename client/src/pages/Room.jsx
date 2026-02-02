import React, { useEffect, useState, useRef } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import { socket } from "../socket";

/* Inline simple components (Chat, Leaderboard, DrawBoard) included here for clarity.
   In a larger app split into separate files. */

function Leaderboard({ players }) {
  return (
    <div className="bg-gradient-to-b from-slate-800 to-slate-900 p-3 rounded-2xl">
      <h3 className="text-sm font-semibold mb-2">Leaderboard</h3>
      <div className="space-y-2">
        {players?.map((p, idx) => (
          <div key={p.id} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center font-semibold text-sm">{idx+1}</div>
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-slate-400">{p.isDrawer ? "Drawer" : "Player"}</div>
              </div>
            </div>
            <div className="font-semibold text-indigo-300">{p.score}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chat({ messages, onSend }) {
  const [text, setText] = useState("");
  const ref = useRef();

  useEffect(() => {
    // scroll to bottom when messages change
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages]);

  function send() {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  }
  function keyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    // min-h-0 is important so this flex child can shrink and allow overflow scrolling
    <div className="flex flex-col h-full min-h-0 bg-gradient-to-b from-slate-800 to-slate-900 p-3 rounded-2xl">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">Chat</h4>
        <div className="text-xs text-slate-400">Public</div>
      </div>

      {/* Constrain messages area: let it grow but not exceed available space, enable scrolling */}
      <div
        ref={ref}
        className="flex-1 overflow-y-auto space-y-2 mb-2 pr-2 max-h-[52vh] min-h-0"
        aria-live="polite"
      >
        {messages.map(m => (
          <div key={m.id} className="text-sm">
            <div className="text-xs text-slate-400">{m.from}</div>
            <div className="text-slate-100">{m.text}</div>
          </div>
        ))}
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={keyDown}
        rows={2}
        className="w-full bg-slate-900 rounded-md p-2 text-slate-100 placeholder:text-slate-400"
        placeholder="Type a guess or message..."
      />
      <div className="mt-2 flex justify-end">
        <button onClick={send} className="px-3 py-1 bg-indigo-600 rounded-md text-white">Send</button>
      </div>
    </div>
  );
}

/* DrawBoard: sends 'stroke' events; receives 'stroke' events to draw.
   (kept unchanged for brevity — include your existing DrawBoard here)
*/
function DrawBoard({ canDraw, onEmitStroke, remoteStrokesResetRef }) {
  const canvasRef = useRef();
  const drawing = useRef(false);
  const ctxRef = useRef(null);
  const [color, setColor] = useState("#ffffff");
  const [size, setSize] = useState(4);
  const [isEraser, setIsEraser] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctxRef.current = ctx;
    function resize() {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (remoteStrokesResetRef) {
      remoteStrokesResetRef.current = () => {
        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = "source-over";
      };
    }
  }, [remoteStrokesResetRef]);

  function drawStrokeOnCanvas(stroke) {
    const ctx = ctxRef.current;
    if (!ctx || !stroke || !stroke.points || stroke.points.length === 0) return;

    const prevComposite = ctx.globalCompositeOperation;
    if (stroke.type === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = stroke.size || 20;
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = stroke.size || 4;
      ctx.strokeStyle = stroke.color || "#fff";
    }

    ctx.beginPath();
    const p0 = stroke.points[0];
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = prevComposite;
  }

  useEffect(() => {
    function handleRemote(e) {
      if (e?.detail?.stroke) drawStrokeOnCanvas(e.detail.stroke);
    }
    window.addEventListener("remoteStroke", handleRemote);
    return () => window.removeEventListener("remoteStroke", handleRemote);
  }, []);

  function getPos(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function pointerDown(e) {
    if (!canDraw) return;
    drawing.current = true;
    const p = getPos(e);
    const stroke = {
      type: isEraser ? "erase" : "draw",
      color: isEraser ? null : color,
      size: isEraser ? Math.max(8, size * 3) : size,
      points: [p]
    };
    canvasRef.current.currentStroke = stroke;
  }
  function pointerMove(e) {
    if (!drawing.current || !canDraw) return;
    const p = getPos(e);
    const cs = canvasRef.current.currentStroke;
    if (!cs) return;
    cs.points.push(p);
    drawStrokeOnCanvas({ ...cs, points: cs.points.slice(-2) });
  }
  function pointerUp() {
    if (!drawing.current || !canDraw) return;
    drawing.current = false;
    const stroke = canvasRef.current.currentStroke;
    if (stroke && stroke.points && stroke.points.length > 0) {
      onEmitStroke && onEmitStroke(stroke);
    }
    canvasRef.current.currentStroke = null;
  }

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    el.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);

    function touchStart(e) {
      if (e.touches && e.touches.length > 0) {
        const t = e.touches[0];
        e.preventDefault();
        pointerDown({ clientX: t.clientX, clientY: t.clientY });
      }
    }
    function touchMove(e) {
      if (e.touches && e.touches.length > 0) {
        const t = e.touches[0];
        e.preventDefault();
        pointerMove({ clientX: t.clientX, clientY: t.clientY });
      }
    }
    function touchEnd(e) {
      e.preventDefault();
      pointerUp();
    }

    el.addEventListener("touchstart", touchStart, { passive: false });
    window.addEventListener("touchmove", touchMove, { passive: false });
    window.addEventListener("touchend", touchEnd, { passive: false });

    el.style.touchAction = "none";

    return () => {
      el.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);

      el.removeEventListener("touchstart", touchStart);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("touchend", touchEnd);
    };
  }, [canDraw, isEraser, color, size]);

  return (
    <div className="bg-gradient-to-br from-[#071226] to-[#061021] rounded-lg p-3 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-2">
            <label className="text-xs text-slate-300">Brush</label>
            <input
              aria-label="Brush size"
              type="range"
              min="1"
              max="40"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="accent-indigo-400"
            />
            <div className="w-7 h-7 flex items-center justify-center rounded" style={{ background: color }} />
          </div>

          <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-2">
            {["#ffffff", "#ff7ab6", "#7afcff", "#ffd86b", "#8b5cf6", "#34d399"].map((c) => (
              <button
                key={c}
                aria-label={`Select color ${c}`}
                onClick={() => { setColor(c); setIsEraser(false); }}
                className={`w-7 h-7 rounded-full border ${color === c && !isEraser ? "ring-2 ring-indigo-400" : "border-slate-700"}`}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEraser((s) => !s)}
            className={`px-3 py-1 rounded-md ${isEraser ? "bg-red-600 text-white" : "bg-slate-800 text-slate-100"}`}
            title="Toggle eraser"
          >
            {isEraser ? "Eraser: ON" : "Eraser"}
          </button>
          <button
            onClick={() => {
              const canvas = canvasRef.current;
              const ctx = ctxRef.current;
              if (!canvas || !ctx) return;
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.globalCompositeOperation = "source-over";
              onEmitStroke && onEmitStroke({ type: "clear" });
            }}
            className="px-3 py-1 rounded-md bg-red-600 hover:bg-red-500 text-sm text-white"
            title="Clear canvas for everyone"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 rounded-md overflow-hidden border border-slate-800">
        <canvas ref={canvasRef} style={{ width: "100%", height: "60vh", display: "block" }} />
      </div>
    </div>
  );
}

export default function Room() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const name = location.state?.name || "Player";
  const [connected, setConnected] = useState(false);

  const [roomState, setRoomState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [localToast, setLocalToast] = useState(null);
  const remoteStrokesResetRef = useRef(null);

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("joinRoom", { roomId: id, name }, (res) => {
        if (!res?.ok) {
          setLocalToast({ type: "error", text: "Failed to join room - it might not exist." });
        }
      });
    });

    socket.on("disconnect", () => setConnected(false));
    socket.on("roomState", (rs) => setRoomState(rs));
    socket.on("chatMessage", (m) => setMessages((s)=>[...s,m]));
    socket.on("toast", (t) => setLocalToast(t));
    socket.on("stroke", (stroke) => {
      if (stroke?.type === "clear") {
        remoteStrokesResetRef.current && remoteStrokesResetRef.current();
        return;
      }
      window.dispatchEvent(new CustomEvent("remoteStroke", { detail: { stroke } }));
    });
    socket.on("wordForDrawer", ({ word }) => {
      setLocalToast({ type: "success", text: `Your word: "${word}" (only you can see this)` });
    });
    socket.on("correctGuess", ({ playerId, name, pointsForGuesser }) => {
      setMessages((s)=>[...s, { id: Date.now(), from: "System", text: `${name} guessed correctly (+${pointsForGuesser})` }]);
    });
    socket.on("roundStarted", (payload) => {
      setMessages((s)=>[...s, { id: Date.now(), from: "System", text: `Round started. Drawer: ${payload.drawerId}. Word length: ${payload.wordLength}` }]);
      remoteStrokesResetRef.current && remoteStrokesResetRef.current();
    });
    socket.on("roundEnded", ({ word, endedBy }) => {
      setMessages((s)=>[...s, { id: Date.now(), from: "System", text: `Round ended. Word: ${word}` }]);
    });

    socket.emit("requestStrokes", null, (res) => {
      if (res?.ok && res.strokes?.length) {
        for (const stroke of res.strokes) {
          if (stroke.type === "clear") {
            remoteStrokesResetRef.current && remoteStrokesResetRef.current();
            continue;
          }
          window.dispatchEvent(new CustomEvent("remoteStroke", { detail: { stroke } }));
        }
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("roomState");
      socket.off("chatMessage");
      socket.off("toast");
      socket.off("stroke");
      socket.off("wordForDrawer");
      socket.off("correctGuess");
      socket.off("roundStarted");
      socket.off("roundEnded");
    };
  }, [id]);

  function sendChat(text) {
    if (!text) return;
    socket.emit("guess", { text }, (res) => {});
  }

  function onSendMessage(text) {
    socket.emit("chatMessage", { text });
  }

  function emitStroke(stroke) {
    socket.emit("stroke", stroke);
  }

  function startRound() {
    socket.emit("startRound", null, (res) => {
      if (!res?.ok) setLocalToast({ type: "error", text: "Failed to start round" });
    });
  }

  function leave() {
    socket.emit("leaveRoom", null, (res) => {
      socket.disconnect();
      navigate("/");
    });
  }

  const players = roomState?.players || [];
  const you = players.find(p=>p.name === name) || { id: null, name };

  const isDrawer = players.findIndex(p => p.id === roomState?.round?.drawerId) !== -1 && (roomState?.round?.drawerId === you.id);

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-500 flex items-center justify-center font-bold">PA</div>
            <div>
              <h1 className="text-2xl font-semibold">Play Area — Room {id}</h1>
              <p className="text-sm text-slate-400">You: <span className="font-medium text-slate-200">{name}</span></p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={startRound} className="px-3 py-2 rounded-md bg-indigo-600 text-white">Start Round</button>
            <button onClick={leave} className="px-3 py-2 rounded-md bg-slate-700 text-slate-200">Leave</button>
          </div>
        </header>

        <main className="flex gap-6">
          <aside className="w-72 hidden lg:block">
            <Leaderboard players={players} />
          </aside>

          <section className="flex-1 min-h-[60vh] bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <DrawBoard canDraw={roomState?.round?.drawerId === you.id} onEmitStroke={emitStroke} remoteStrokesResetRef={remoteStrokesResetRef} />
          </section>

          {/* add min-h-0 so the chat's flex child can overflow instead of stretching page */}
          <aside className="w-80 hidden md:flex flex-col min-h-0">
            <Chat messages={messages} onSend={(msg)=>{ socket.emit("guess", { text: msg }, ()=>{});}} />
          </aside>
        </main>

        {localToast && (
          <div className="fixed bottom-6 right-6 bg-slate-800 text-slate-100 p-3 rounded-md shadow">
            {localToast.text}
          </div>
        )}
      </div>
    </div>
  );
}