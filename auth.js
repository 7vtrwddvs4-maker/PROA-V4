import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

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

// Variable en memoria volátil (desaparece al cerrar pestaña o recargar)
let sessionEncryptionKey = null;

export async function loginUsuario(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    // Guardamos la contraseña en memoria exclusivamente para alimentar el motor AES
    sessionEncryptionKey = password;
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