import { io } from "socket.io-client";

const SERVER = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
export const socket = io(SERVER, { autoConnect: false });