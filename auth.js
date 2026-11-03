import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";

// Tu configuración de Firebase PROA v4
const firebaseConfig = {
  apiKey: "AIzaSyAp7mDwWtouXR9gshDQOZqy2r9xHAITS4o",
  authDomain: "proa-v4.firebaseapp.com",
  projectId: "proa-v4",
  storageBucket: "proa-v4.firebasestorage.app",
  messagingSenderId: "1019677676476",
  appId: "1:1019677676476:web:b6726214c6d3b1114491b9"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Llave Institucional Compartida en memoria volátil (se activa solo tras autenticar cualquier cuenta del hospital)
let sessionEncryptionKey = null;
const LLAVE_INSTITUCIONAL_PROA = "HEP_PROA_V4_MASTER_VAULT_2026";

export async function loginUsuario(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    sessionEncryptionKey = LLAVE_INSTITUCIONAL_PROA;
    return { exito: true, user: userCredential.user };
  } catch (error) {
    return { exito: false, mensaje: error.message };
  }
}

export async function crearCuentaUsuario(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    sessionEncryptionKey = LLAVE_INSTITUCIONAL_PROA;
    return { exito: true, user: userCredential.user };
  } catch (error) {
    return { exito: false, mensaje: error.message };
  }
}

export async function cerrarSesion() {
  sessionEncryptionKey = null;
  await signOut(auth);
}

export function obtenerLlaveSesion() {
  if (!sessionEncryptionKey) {
    throw new Error("No hay una sesión activa o la llave de cifrado expiró.");
  }
  return sessionEncryptionKey;
}