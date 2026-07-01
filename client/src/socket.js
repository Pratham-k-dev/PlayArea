import { io } from "socket.io-client";
import dotenv from "dotenv";
const SERVER = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
console.log(import.meta.env.VITE_SERVER_URL);
export const socket = io(SERVER, { autoConnect: false });