import { getFirestore, doc, setDoc, addDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, serverTimestamp, onSnapshot } from "firebase/firestore";
import { auth, obtenerLlaveSesion } from "./auth.js";

const db = getFirestore();

export const DICCIONARIO_DIAS_GRACIA = {
  "AMIKACINA EV 500MG/2ML": 4,
  "AMPICILINA + SULBACTAM EV 1GR/0,5GR": 4,
  "AZITROMICINA EV 500MG/10 ML": 4,
  "CEFOTAXIMA EV 1GR": 4,
  "CEFTAZIDIMA EV 1GR": 4,
  "CEFTRIAXONA EV 1GR": 4,
  "CIPROFLOXACINO EV 200MG": 4,
  "CLINDAMICINA FOSFATO EV 600MG/4ML": 4,
  "GENTAMICINA SULFATO EV 80MG/2ML": 4,
  "LEVOFLOXACINO EV 5 MG/ML": 4,
  "OSELTAMIVIR VO 75MG": 4,
  "PIPERACILINA+ TAZOBACTAM EV 4GR+0.5GR": 4,
  "TIGECICLINA EV 50MG": 4,
  "AMFOTERICINA B 50MG": 3,
  "AZTREONAM 1000 MG": 3,
  "ACICLOVIR EV 250MG": 3,
  "ACICLOVIR EV 500MG": 3,
  "ANIDULAFUNGINA EV 100MG": 3,
  "CEFEPIME EV 1GR": 3,
  "CEFPODOXIMA VO 200MG": 3,
  "CEFTAZIDIMA + AVIBACTAM EV 2GR/0,5GR": 3,
  "COLISTINA EV 3.000.000UI": 3,
  "COLISTINA EV 4.500.000UI": 3,
  "COTRIMOXAZOL EV 400MG SMT + 80MG TMP": 3,
  "DAPTOMICINA 500 MG": 3,
  "ERTAPENEM EV 1GR": 3,
  "FLUCONAZOL EV 200MG": 3,
  "FOSFOMICINA VO 3GR": 3,
  "ISAVUCONAZOL 100 MG": 3,
  "IMIPENEN + CILASTINA EV 500MG + 500MG": 3,
  "LINEZOLIDEV 600MG/300ML": 3,
  "LINEZOLID VO 600MG": 3,
  "MEROPENEM EV 1GR": 3,
  "VANCOMICINA EV 500MG": 3,
  "VORICONAZOL EV 200MG": 3,
  "VORICONAZOL VO 200MG": 3,
  "CEFTOLOZANO - TAZOBACTAM 1000 + 500MG": 3,
  "VANCOMICINA VO 500MG": 3
};

export async function generarHashRut(rut) {
  const limpio = String(rut).trim().toUpperCase().replace(/[^0-9K]/g, '');
  const msgBuffer = new TextEncoder().encode(limpio || "SR_" + Date.now());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function cifrarObjeto(objeto, secretKey) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const baseKey = await crypto.subtle.importKey("raw", enc.encode(secretKey), "PBKDF2", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );

  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, aesKey, enc.encode(JSON.stringify(objeto))
  );

  return {
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    payload: btoa(String.fromCharCode(...new Uint8Array(encryptedContent)))
  };
}

async function intentarDescifradoConClave(boveda, claveTexto) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const salt = new Uint8Array(atob(boveda.salt).split("").map(c => c.charCodeAt(0)));
  const iv = new Uint8Array(atob(boveda.iv).split("").map(c => c.charCodeAt(0)));
  const data = new Uint8Array(atob(boveda.payload).split("").map(c => c.charCodeAt(0)));

  const baseKey = await crypto.subtle.importKey("raw", enc.encode(claveTexto), "PBKDF2", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );

  const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, data);
  return JSON.parse(dec.decode(decryptedBuffer));
}

async function descifrarObjeto(boveda, secretKey) {
  try {
    return await intentarDescifradoConClave(boveda, secretKey);
  } catch (e) {
    // Compatibilidad automática con los pacientes creados en las primeras pruebas
    return await intentarDescifradoConClave(boveda, "tsubasa314");
  }
}

// Escucha cambios en tiempo real en Firestore sin necesidad de botón de sincronizar
export function suscribirCambiosEnTiempoReal(callbackRecarga) {
  let debounceTimer = null;
  const disparar = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => callbackRecarga(), 250);
  };
  onSnapshot(collection(db, "pacientes"), disparar);
  onSnapshot(doc(db, "sistema_config", "registro_notificaciones"), disparar);
  onSnapshot(doc(db, "sistema_config", "pulso_tiempo_real"), disparar);
}

export async function registrarIngresoMultipleCifrado(payload) {
  const passwordSesion = obtenerLlaveSesion();
  const rutUpper = payload.rut.trim().toUpperCase();
  const esSR = (rutUpper === "S/R" || rutUpper === "NN" || rutUpper === "S/I");
  const semillaHash = esSR ? `SR_${payload.nombre.trim().toUpperCase()}_${payload.apellido.trim().toUpperCase()}` : rutUpper;
  const hashDocId = await generarHashRut(semillaHash);

  const bovedaIdentidad = await cifrarObjeto({
    rut: rutUpper,
    nombre: payload.nombre.trim().toUpperCase(),
    apellido: payload.apellido.trim().toUpperCase(),
    cama: payload.cama.trim().toUpperCase()
  }, passwordSesion);

  const pacienteRef = doc(db, "pacientes", hashDocId);
  await setDoc(pacienteRef, {
    boveda_identidad: bovedaIdentidad,
    servicio_actual: payload.servicio.trim().toUpperCase(),
    activo: true,
    fecha_registro: serverTimestamp()
  }, { merge: true });

  const tratamientosRef = collection(db, "pacientes", hashDocId, "tratamientos");
  let insertados = 0;

  for (const t of payload.tratamientos) {
    const bovedaClinica = await cifrarObjeto({
      diagnostico: t.diagnostico || "",
      observaciones: t.observaciones || ""
    }, passwordSesion);

    const diasGracia = DICCIONARIO_DIAS_GRACIA[t.medicamento.toUpperCase()] || 4;

    await addDoc(tratamientosRef, {
      estado: t.estado || "SOLICITUD",
      antimicrobiano: t.medicamento.trim().toUpperCase(),
      carga: t.carga || "NO",
      dosis: t.dosis.trim().toUpperCase(),
      frecuencia: t.frecuencia.trim().toUpperCase(),
      fecha_inicio: payload.fecha.trim(),
      dias_predeterminados: diasGracia,
      digitador: payload.digitador.trim().toUpperCase(),
      tipo_tratamiento: t.tipoTratamiento || "",
      tipo_terapia: t.tipoTerapia || "",
      lugar_infeccion: t.lugarInfeccion || "",
      conducta: t.conducta || "",
      dias_autorizacion: t.diasAutorizacion ? Number(t.diasAutorizacion) : null,
      uso_adecuado: t.usoAdecuado || "",
      visador: t.visador || "",
      fecha_visado: t.fechaVisado || "",
      paciente_no_encontrado: t.pacienteNoEncontrado || "",
      boveda_clinica: bovedaClinica,
      creado_el: serverTimestamp()
    });
    insertados++;
  }

  return { exito: true, hashId: hashDocId, cantidad: insertados };
}

// Guarda toda la Auditoría Clínica QF (Actualiza datos del paciente, actualiza tratamientos existentes e inserta nuevos)
export async function guardarAuditoriaCompletaQF(payload) {
  const passwordSesion = obtenerLlaveSesion();
  const hashDocId = payload.hashPaciente;

  // 1. Actualizar datos de identidad y ubicación del paciente
  const bovedaIdentidad = await cifrarObjeto({
    rut: payload.rut.trim().toUpperCase(),
    nombre: payload.nombre.trim().toUpperCase(),
    apellido: payload.apellido.trim().toUpperCase(),
    cama: payload.cama.trim().toUpperCase()
  }, passwordSesion);

  await setDoc(doc(db, "pacientes", hashDocId), {
    boveda_identidad: bovedaIdentidad,
    servicio_actual: payload.servicio.trim().toUpperCase(),
    ultima_auditoria: serverTimestamp()
  }, { merge: true });

  // 2. Procesar cada tarjeta de tratamiento (Update o Insert)
  const colRef = collection(db, "pacientes", hashDocId, "tratamientos");

  for (const t of payload.tratamientos) {
    const bovedaClinica = await cifrarObjeto({
      diagnostico: t.diagnostico || "",
      observaciones: t.observaciones || ""
    }, passwordSesion);

    const amUpper = t.antimicrobiano.trim().toUpperCase();
    const diasGracia = DICCIONARIO_DIAS_GRACIA[amUpper] || 4;

    const datosDoc = {
      estado: t.estado || "SOLICITUD",
      antimicrobiano: amUpper,
      carga: t.carga || "NO",
      dosis: t.dosis.trim().toUpperCase(),
      frecuencia: t.frecuencia.trim().toUpperCase(),
      fecha_inicio: t.fechaInicio,
      dias_predeterminados: diasGracia,
      digitador: t.digitador || "QF",
      tipo_tratamiento: t.tipoTratamiento || "",
      tipo_terapia: t.tipoTerapia || "",
      lugar_infeccion: t.lugarInfeccion || "",
      conducta: t.estadoClinico || "",
      dias_autorizacion: t.diasAprob !== "" && t.diasAprob !== null ? Number(t.diasAprob) : null,
      uso_adecuado: t.usoAdecuado || "",
      visador: t.visador || "",
      fecha_visado: t.fechaVisado || "",
      boveda_clinica: bovedaClinica
    };

    if (t.idTratamiento) {
      await updateDoc(doc(db, "pacientes", hashDocId, "tratamientos", t.idTratamiento), datosDoc);
    } else {
      datosDoc.creado_el = serverTimestamp();
      await addDoc(colRef, datosDoc);
    }
  }

  return { exito: true };
}

// Elimina un tratamiento de Firestore si se borra desde la Auditoría QF
export async function eliminarTratamientoFirestore(hashPaciente, idTratamiento) {
  await deleteDoc(doc(db, "pacientes", hashPaciente, "tratamientos", idTratamiento));
  return { exito: true };
}

export async function obtenerMatrizCompletaDescifrada() {
  const passwordSesion = obtenerLlaveSesion();
  const snapPacientes = await getDocs(collection(db, "pacientes"));
  const filasMatriz = [];

  for (const docPac of snapPacientes.docs) {
    const pacData = docPac.data();
    if (!pacData.boveda_identidad) continue;

    let identidad = null;
    try {
      identidad = await descifrarObjeto(pacData.boveda_identidad, passwordSesion);
    } catch (e) { continue; }

    const snapTrats = await getDocs(collection(db, "pacientes", docPac.id, "tratamientos"));
    for (const docTrat of snapTrats.docs) {
      const t = docTrat.data();
      let clinica = { diagnostico: "", observaciones: "" };
      if (t.boveda_clinica) {
        try { clinica = await descifrarObjeto(t.boveda_clinica, passwordSesion); } catch (e) {}
      }

      const amUpper = (t.antimicrobiano || "").toUpperCase();
      const diasPred = t.dias_predeterminados || DICCIONARIO_DIAS_GRACIA[amUpper] || 4;

      filasMatriz.push({
        idTratamiento: docTrat.id,
        hashPaciente: docPac.id,
        estado: t.estado || "SOLICITUD",
        antimicrobiano: amUpper,
        carga: t.carga || "NO",
        dosis: t.dosis || "",
        frecuencia: t.frecuencia || "",
        fecha_inicio: t.fecha_inicio || "",
        dias_predeterminados: diasPred,
        servicio: pacData.servicio_actual || "",
        cama: identidad.cama || "",
        nombre: identidad.nombre || "",
        apellido: identidad.apellido || "",
        rut: identidad.rut || "",
        digitador: t.digitador || "",
        diagnostico: clinica.diagnostico || "",
        observaciones: clinica.observaciones || "",
        tipo_tratamiento: t.tipo_tratamiento || "",
        tipo_terapia: t.tipo_terapia || "",
        lugar_infeccion: t.lugar_infeccion || "",
        conducta: t.conducta || "",
        dias_autorizacion: t.dias_autorizacion !== undefined ? t.dias_autorizacion : null,
        uso_adecuado: t.uso_adecuado || "",
        visador: t.visador || "",
        fecha_visado: t.fecha_visado || "",
        paciente_no_encontrado: t.paciente_no_encontrado || "",
        creado_ms: t.creado_el && t.creado_el.toMillis ? t.creado_el.toMillis() : 0
      });
    }
  }

  return filasMatriz;
}

export async function inicializarCatalogosSistema() {
  const catalogosRef = doc(db, "sistema_config", "listas_maestras");
  await setDoc(catalogosRef, {
    servicios: [
      "CIRUGIA", "HDM", "MATERNIDAD", "MEDICINA", "PENSIONADO", 
      "UCI", "UCM", "UHCIP", "URG ADULTO", "UTI", "PABELLON", "URG MATER"
    ],
    antimicrobianos: Object.keys(DICCIONARIO_DIAS_GRACIA).sort(),
    dosis: [
      "15 MG", "40 MG", "50 MG", "75 MG", "80 MG", "100 MG", "125 MG", "150 MG", "160 MG", "170 MG",
      "200 MG", "240 MG", "250 MG", "300 MG", "320 MG", "340 MG", "400 MG", "430 MG", "480 MG", "500 MG",
      "600 MG", "700 MG", "750 MG", "800 MG", "850 MG", "900 MG", "960 MG", "1000 MG", "1250 MG", "1300 MG",
      "1440 MG", "1500 MG", "1750 MG", "1920 MG", "2000 MG", "2250 MG", "2400 MG", "2500 MG", "2750 MG",
      "2880 MG", "3000 MG", "3375 MG", "3500 MG", "3600 MG", "3750 MG", "4000 MG", "4500 MG", "5000 MG",
      "6000 MG", "9000 MG", "2 MILLONES", "3 MILLONES", "4,5 MILLONES", "6 MILLONES", "9 MILLONES", "12 MILLONES"
    ],
    frecuencias: [
      "24 HRS", "12 HRS", "8 HRS", "6 HRS", "48 HRS", "36 HRS", "72 HRS", "96 HRS", "4 HRS", "3 HRS", "2 HRS"
    ],
    digitadores: [
      "FRANCISCO BARRA", "VIRNA", "TERESA", "VIVIANA GONZALEZ", "SIDNEY", "PAULINA DIAZ",
      "JOSE VALDERRAMA", "GABRIEL ARIAS", "MARCELO URTUBIA", "NATALIA GUAJARDO", "BELEN QUINTEROS",
      "DANITZA", "LEONARDO", "FRANCISCO REYES", "FRANCISCA ARANCIBIA", "DANILO", "PAULINA CABRERA",
      "MONSERRAT", "FERNANDA SEPULVEDA", "TAMARA MALDONADO", "BYRON", "SEBASTIAN CHAVEZ",
      "JAVIERA CARRASCO", "JOAQUIN CALDERON", "CLAUDIO VILLAGRA", "EMILIA GARCES", "OTRO"
    ],
    visadores: [
      "Gil Dra.", "Quinteros QF", "Valderrama QF", "Gebuer Dra.", "Calderón QF.", "Urtubia QF.",
      "Arias QF.", "Castillo Dr.", "Fuenzalida Dra.", "Guzman Dra.", "Rodriguez Dr.", "Chavez QF.",
      "Vargas Dr.", "González QF."
    ],
    diagnosticos: [
      "ITU COMPLICADA", "ITU NO COMPLICADA", "NAC LEVE", "NAC MODERADA", "NAC SEVERA",
      "NEUMONIA ASPIRATIVA", "NAAS", "NAVM", "ITS CVC", "PNA", "SHOCK SEPTICO", "FOCO MIXTO",
      "PIE DIABETICO", "BACTEREMIA", "SINDROME FEBRIL", "ASPERGILLUS", "CANDIDEMIA",
      "NEUTROPENIA FEBRIL", "SEPSIS", "CELULITIS", "OSTEOMIELITIS", "UPP INFECTADA",
      "MENINGITIS", "FASCITIS NECROTIZANTE", "GANGRENA FORNIER", "COVID", "INFLUENZA",
      "ENDOCARDITIS", "ABSCESO", "DEHISCENCIA HERIDA OPERATORIA", "OTRAS INFECCIONES",
      "FOCO ABDOMINAL", "PIEL Y PARTES BLANDAS", "INFECCION GINECOLOGICA", "HISTERECTOMIA",
      "APENDICITIS", "COLECCIÓN INTRAABDOMINAL", "EMPIEMA", "DIARREA POR CLOSTRIDIUM DIFFICILE",
      "PROSTATITIS", "ARTRITIS SÉPTICA", "COLECISTITIS AGUDA", "FUNGEMIA", "COLANGITIS",
      "PERITONITIS BACTERIANA ESPONTANEA", "PERITONITIS BACTERIANA SECUNDARIA", "INFECCIÓN DE SITIO QUIRÚRGICO"
    ]
  }, { merge: true });
}

export async function obtenerCatalogosSistema() {
  const snap = await getDoc(doc(db, "sistema_config", "listas_maestras"));
  return snap.exists() ? snap.data() : null;
}

// =========================================================================
// PERFILES DE ROL (QF vs TENS), EDICIÓN EN MATRIZ BRUTA Y NOTIFICACIONES
// =========================================================================

export async function guardarPerfilUsuario(uid, datosPerfil) {
  await setDoc(doc(db, "sistema_config", "usuarios_roles"), {
    [uid]: {
      nombre: datosPerfil.nombre.trim().toUpperCase(),
      rol: datosPerfil.rol, // "QF" o "TENS"
      email: datosPerfil.email,
      actualizado: new Date().toISOString()
    }
  }, { merge: true });
}

export async function obtenerPerfilUsuario(uid) {
  const snap = await getDoc(doc(db, "sistema_config", "usuarios_roles"));
  if (snap.exists() && snap.data()[uid]) {
    return snap.data()[uid];
  }
  return null;
}

// Edición completa en vivo de cualquier celda (Zona Azul, Zona Verde y Zona Amarilla) desde la Matriz General
export async function actualizarRapidoDesdeMatriz(hashPaciente, idTratamiento, camposNuevosTrat, bovedaClinicaActualizada = null, bovedaIdentidadActualizada = null, nuevoServicio = null) {
  const passwordSesion = obtenerLlaveSesion();
  const pacRef = doc(db, "pacientes", hashPaciente);
  const tratRef = doc(db, "pacientes", hashPaciente, "tratamientos", idTratamiento);

  // 1. Si se editó algún campo de Tratamiento o Bóveda Clínica
  const payloadUpdateTrat = { ...camposNuevosTrat };
  if (bovedaClinicaActualizada) {
    payloadUpdateTrat.boveda_clinica = await cifrarObjeto({
      diagnostico: bovedaClinicaActualizada.diagnostico || "",
      observaciones: bovedaClinicaActualizada.observaciones || ""
    }, passwordSesion);
  }
  if (Object.keys(payloadUpdateTrat).length > 0) {
    await updateDoc(tratRef, payloadUpdateTrat);
  }

  // 2. Si se editó Identidad (RUT, Nombre, Apellido, Cama) o Servicio en la Zona Azul
  const payloadUpdatePac = { ultima_modificacion: serverTimestamp() };
  if (nuevoServicio !== null) {
    payloadUpdatePac.servicio_actual = nuevoServicio.trim().toUpperCase();
  }
  if (bovedaIdentidadActualizada) {
    payloadUpdatePac.boveda_identidad = await cifrarObjeto({
      rut: bovedaIdentidadActualizada.rut.trim().toUpperCase(),
      nombre: bovedaIdentidadActualizada.nombre.trim().toUpperCase(),
      apellido: bovedaIdentidadActualizada.apellido.trim().toUpperCase(),
      cama: bovedaIdentidadActualizada.cama.trim().toUpperCase()
    }, passwordSesion);
  }
  await setDoc(pacRef, payloadUpdatePac, { merge: true });
  await setDoc(doc(db, "sistema_config", "pulso_tiempo_real"), { ts: Date.now() }, { merge: true });

  return { exito: true };
}

// Guarda las notificaciones en sistema_config/registro_notificaciones (100% permitido por las reglas de Firestore)
export async function registrarNotificacionPROA(mensajeClaro, tipo = "VISACION") {
  try {
    const passwordSesion = obtenerLlaveSesion();
    const bovedaNotif = await cifrarObjeto({ mensaje: mensajeClaro }, passwordSesion);
    const refNotif = doc(db, "sistema_config", "registro_notificaciones");
    const snap = await getDoc(refNotif);
    let historial = [];
    if (snap.exists() && Array.isArray(snap.data().items)) {
      historial = snap.data().items;
    }

    historial.unshift({
      id: "n_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      tipo,
      boveda_notif: bovedaNotif,
      fecha_hora: new Date().toLocaleString("es-CL"),
      creado_ms: Date.now()
    });

    // Mantener las últimas 40 notificaciones
    await setDoc(refNotif, {
      items: historial.slice(0, 40),
      actualizado_ms: Date.now()
    }, { merge: true });
  } catch (e) {
    console.warn("Error registrando notificación:", e);
  }
}

export async function obtenerNotificacionesDescifradas() {
  try {
    const passwordSesion = obtenerLlaveSesion();
    const snap = await getDoc(doc(db, "sistema_config", "registro_notificaciones"));
    if (!snap.exists() || !Array.isArray(snap.data().items)) return [];

    const lista = [];
    for (const item of snap.data().items) {
      if (!item.boveda_notif) continue;
      try {
        const claro = await descifrarObjeto(item.boveda_notif, passwordSesion);
        lista.push({
          id: item.id,
          tipo: item.tipo || "INFO",
          mensaje: claro.mensaje,
          fecha_hora: item.fecha_hora || "",
          creado_ms: item.creado_ms || 0
        });
      } catch (err) {}
    }
    return lista;
  } catch (e) {
    return [];
  }
}

export async function eliminarNotificacionPROA(idNotif) {
  try {
    const refNotif = doc(db, "sistema_config", "registro_notificaciones");
    const snap = await getDoc(refNotif);
    if (!snap.exists() || !Array.isArray(snap.data().items)) return { exito: false };

    const filtradas = snap.data().items.filter(item => item.id !== idNotif);
    await setDoc(refNotif, {
      items: filtradas,
      actualizado_ms: Date.now()
    }, { merge: true });
    return { exito: true };
  } catch (e) {
    console.warn("Error al eliminar notificación:", e);
    return { exito: false };
  }
}