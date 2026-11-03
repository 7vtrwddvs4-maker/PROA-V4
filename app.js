import { loginUsuario, crearCuentaUsuario, cerrarSesion } from "./auth.js";
import {
  registrarIngresoMultipleCifrado,
  obtenerCatalogosSistema,
  inicializarCatalogosSistema,
  obtenerMatrizCompletaDescifrada,
  guardarAuditoriaCompletaQF,
  eliminarTratamientoFirestore,
  guardarPerfilUsuario,
  obtenerPerfilUsuario,
  actualizarRapidoDesdeMatriz,
  registrarNotificacionPROA,
  obtenerNotificacionesDescifradas,
  suscribirCambiosEnTiempoReal
} from "./proaService.js";

let PERFIL_ACTUAL = { nombre: "FRANCISCO BARRA", rol: "QF", email: "" };
let MODO_CREAR_CUENTA = false;
let TIMER_CARRUSEL_SIDEBAR = null;
let INDICE_CARRUSEL_SRV = 0;
let VER_LISTA_PACIENTES_SIDEBAR = false;

let MEMORIA_FILAS = [];
let MODO_SIDEBAR = "PACIENTES";
let PACIENTES_EXPANDIDOS = new Set();
let PACIENTE_AUDITORIA_ACTUAL = null; // Guarda el hashPaciente y sus filas en el modal QF

let SERVICIO_SELECCIONADO_SIDEBAR = "TODOS";

document.addEventListener("DOMContentLoaded", () => {
  const hoyISO = new Date().toISOString().split("T")[0];
  document.getElementById("in-fecha").value = hoyISO;
  agregarFilaMedicamento();

  // Cargar cuenta recordada si existe en este equipo
  try {
    const saved = localStorage.getItem("proa_v4_saved_auth");
    if (saved) {
      const parsed = JSON.parse(atob(saved));
      if (parsed.email) document.getElementById("login-email").value = parsed.email;
      if (parsed.pass) document.getElementById("login-pass").value = parsed.pass;
      document.getElementById("login-remember").checked = true;
    }
  } catch (e) {}
});

window.toggleModoCrearCuentaLogin = function() {
  MODO_CREAR_CUENTA = !MODO_CREAR_CUENTA;
  document.getElementById("bloque-registro-rol").style.display = MODO_CREAR_CUENTA ? "block" : "none";
  document.getElementById("txt-btn-login").innerText = MODO_CREAR_CUENTA ? "GUARDAR ROL / CREAR CUENTA" : "DESBLOQUEAR SISTEMA";
};

// 1. AUTENTICACIÓN Y CONFIGURACIÓN DE ROL (QF vs TENS)
window.iniciarSesionApp = async function() {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-pass").value;
  const recordar = document.getElementById("login-remember")?.checked;
  const nombreInput = document.getElementById("login-nombre-profesional")?.value.trim();
  const rolInput = document.getElementById("login-rol-profesional")?.value || "QF";
  const errorEl = document.getElementById("login-error");
  const btn = document.getElementById("btn-login");

  errorEl.style.display = "none";
  btn.disabled = true;

  // Intentamos iniciar sesión; si está en modo crear cuenta y no existe, la crea en Firebase Auth
  let res = await loginUsuario(email, pass);
  if (!res.exito && MODO_CREAR_CUENTA) {
    res = await crearCuentaUsuario(email, pass);
  }

  if (res.exito) {
    if (recordar) {
      localStorage.setItem("proa_v4_saved_auth", btoa(JSON.stringify({ email, pass })));
    } else {
      localStorage.removeItem("proa_v4_saved_auth");
    }

    // Si el usuario abrió el panel de configurar rol/nombre, lo guardamos en Firestore
    if (MODO_CREAR_CUENTA && nombreInput) {
      await guardarPerfilUsuario(res.user.uid, { nombre: nombreInput, rol: rolInput, email });
    }

    const MAPA_CORREOS_NOMBRES = {
      "barra.francisco30@gmail.com": "FRANCISCO BARRA",
      "marcelourtubiaevert@gmail.com": "Urtubia QF.",
      "jl.valderrama.cortes@gmail.com": "Valderrama QF",
      "belenquinterosaguilera30@gmail.com": "Quinteros QF",
      "vivianaisabel.gl@gmail.com": "González QF.",
      "joacocalderonn@gmail.com": "Calderón QF.",
      "s.chavezg@outlook.com": "Chavez QF.",
      "claudio.villagra3@gmail.com": "CLAUDIO VILLAGRA"
    };

    let perfilGuardado = await obtenerPerfilUsuario(res.user.uid);
    const nombrePorCorreo = MAPA_CORREOS_NOMBRES[email.toLowerCase()];

    if (!perfilGuardado) {
      const nombreDefecto = nombreInput || nombrePorCorreo || email.split("@")[0].toUpperCase();
      perfilGuardado = { nombre: nombreDefecto, rol: rolInput || "QF", email };
      await guardarPerfilUsuario(res.user.uid, perfilGuardado);
    } else if (perfilGuardado.nombre === "BARRA.FRANCISCO30" || (nombrePorCorreo && !nombreInput)) {
      // Corrige automáticamente si antes se había guardado con el prefijo del correo
      perfilGuardado.nombre = nombreInput || nombrePorCorreo || perfilGuardado.nombre;
      await guardarPerfilUsuario(res.user.uid, perfilGuardado);
    }

    PERFIL_ACTUAL = perfilGuardado;
    aplicarPermisosSegunRolUI();

    document.getElementById("vista-login").style.display = "none";
    await inicializarCatalogosSistema();
    await poblarDatalists();
    await cargarMatrizEnVivo();
    await cargarNotificacionesEnVivo();
    iniciarCarruselAutomaticoSidebar();
    suscribirCambiosEnTiempoReal(async () => {
      await cargarMatrizEnVivo();
      await cargarNotificacionesEnVivo();
    });
  } else {
    errorEl.innerText = "Error: " + res.mensaje;
    errorEl.style.display = "block";
    btn.disabled = false;
  }
};

function aplicarPermisosSegunRolUI() {
  const esQF = PERFIL_ACTUAL.rol === "QF";
  document.getElementById("header-user-name").innerText = PERFIL_ACTUAL.nombre || PERFIL_ACTUAL.email;
  document.getElementById("header-user-role-badge").innerText =
    esQF ? "🟣 ROL: QUÍMICO FARMACÉUTICO (Cambiar)" : "🔵 ROL: TENS FARMACIA (Cambiar)";

  // Autocompletar el digitador con el nombre del usuario conectado
  const inDig = document.getElementById("in-digitador");
  if (inDig && PERFIL_ACTUAL.nombre) inDig.value = PERFIL_ACTUAL.nombre;

  // Botón superior de Auditoría Visación: exclusivo para QF
  const btnAudTop = document.getElementById("btn-top-auditoria-qf");
  if (btnAudTop) btnAudTop.style.display = esQF ? "inline-flex" : "none";

  // En el formulario de ingreso, si es TENS bloqueamos el Estado en SOLICITUD
  document.querySelectorAll(".med-estado").forEach(sel => {
    if (!esQF) {
      sel.value = "SOLICITUD";
      sel.disabled = true;
      sel.title = "Los perfiles TENS solo pueden ingresar tratamientos en estado SOLICITUD";
    } else {
      sel.disabled = false;
      sel.title = "";
    }
  });
}

// Permite alternar rápidamente entre vista QF y vista TENS haciendo clic en el badge del rol arriba a la derecha
window.cambiarRolRapidoPruebas = function() {
  PERFIL_ACTUAL.rol = PERFIL_ACTUAL.rol === "QF" ? "TENS" : "QF";
  aplicarPermisosSegunRolUI();
  renderizarTablaMatriz();
  renderizarBarraLateral();
};

window.cerrarSesionApp = async function() {
  await cerrarSesion();
  window.location.reload();
};

let CATALOGOS_MEMORIA = {
  servicios: [], antimicrobianos: [], dosis: [], frecuencias: [],
  digitadores: [], visadores: [], diagnosticos: [],
  tipoTto: ["INICIO", "CONTINUACIÓN"],
  tipoTerapia: ["EMPIRICA", "ESPECIFICA", "PROFILACTICA"],
  lugarInf: ["EXTRAHOSPITALARIA", "INTRAHOSPITALARIA"],
  estadoClinico: ["AUTORIZADO", "SUSPENDIDO", "SUSPENDIDO POR OTRO", "CAMBIO DE TRATAMIENTO", "PACIENTE NO ENCONTRADO", "FALLECIDO", "TRASLADO"],
  usoAdecuado: ["CAMBIO DE ATM", "AJUSTE POR ANTIBIOGRAMAS", "CAMBIO POR EVOLUCION DESFAVORABLE", "DESESCALAMIENTO DE TERAPIA", "AJUSTE DE DOSIS", "AJUSTE DIAS DE TRATAMIENTO"],
  pacNoEncontrado: ["", "NO ENCONTRADO EN SALA", "EN PABELLÓN / PROCEDIMIENTO", "TRASLADADO DE UNIDAD", "ALTA MÉDICA", "FALLECIDO"]
};

async function poblarDatalists() {
  const cat = await obtenerCatalogosSistema();
  if (cat) {
    CATALOGOS_MEMORIA = { ...CATALOGOS_MEMORIA, ...cat };
  }
  const selectSrvMatriz = document.getElementById("filtro-matriz-servicio");
  if (selectSrvMatriz && CATALOGOS_MEMORIA.servicios) {
    selectSrvMatriz.innerHTML = `<option value="TODOS">Servicio: Todos</option>` +
      CATALOGOS_MEMORIA.servicios.map(s => `<option value="${s}">${s}</option>`).join("");
  }
  inicializarMotorAutocompletadoTeclado();
}

// MOTOR UNIVERSAL DE TECLADO: FLECHAS ARRIBA/ABAJO + ENTER Y TAB (SALTA FECHA AUTOMÁTICAMENTE)
function inicializarMotorAutocompletadoTeclado() {
  if (document.getElementById("ac-global-popup")) return;

  const popup = document.createElement("div");
  popup.id = "ac-global-popup";
  popup.className = "ac-popup-menu";
  document.body.appendChild(popup);

  let inputActivo = null;
  let itemsActuales = [];
  let indiceSeleccionado = 0;

  function posicionarPopup(input) {
    const rect = input.getBoundingClientRect();
    const alturaEstimadaMenu = Math.min(itemsActuales.length * 35 + 10, 220);
    const espacioAbajo = window.innerHeight - rect.bottom;

    // Evita que se salga por la derecha de la pantalla
    const anchoMenu = Math.max(rect.width, 250);
    const leftSeguro = Math.min(rect.left, window.innerWidth - anchoMenu - 12);
    popup.style.left = `${Math.max(8, leftSeguro)}px`;
    popup.style.width = `${anchoMenu}px`;

    // Si estamos en el último paciente y no cabe abajo, se despliega hacia arriba
    if (espacioAbajo < alturaEstimadaMenu + 16 && rect.top > alturaEstimadaMenu) {
      popup.style.top = "auto";
      popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      popup.style.bottom = "auto";
      popup.style.top = `${rect.bottom + 4}px`;
    }
  }

  function renderizarOpciones(input) {
    const claveCatalogo = input.dataset.ac;
    if (!claveCatalogo || !CATALOGOS_MEMORIA[claveCatalogo]) {
      popup.style.display = "none";
      return;
    }

    const texto = input.value.trim().toUpperCase();
    const listaBase = CATALOGOS_MEMORIA[claveCatalogo] || [];

    // Ordenar: primero los que empiezan con lo escrito, luego los que lo contienen
    const empiezan = listaBase.filter(item => item.toUpperCase().startsWith(texto));
    const contienen = listaBase.filter(item => !item.toUpperCase().startsWith(texto) && item.toUpperCase().includes(texto));
    itemsActuales = [...empiezan, ...contienen].slice(0, 10);

    if (itemsActuales.length === 0) {
      popup.style.display = "none";
      return;
    }

    indiceSeleccionado = 0;
    posicionarPopup(input);
    actualizarVistaItems();
    popup.style.display = "block";
  }

  function actualizarVistaItems() {
    popup.innerHTML = itemsActuales.map((item, idx) => `
      <div class="ac-popup-item ${idx === indiceSeleccionado ? "ac-active" : ""}" data-idx="${idx}">
        <span>${item}</span>
        ${idx === indiceSeleccionado ? `<span class="ac-kbd-hint">↵ Enter / Tab</span>` : ""}
      </div>
    `).join("");

    const itemActivoDOM = popup.querySelector(".ac-active");
    if (itemActivoDOM) itemActivoDOM.scrollIntoView({ block: "nearest" });

    popup.querySelectorAll(".ac-popup-item").forEach(el => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        seleccionarYAvanzar(Number(el.dataset.idx));
      });
    });
  }

  function seleccionarYAvanzar(idx) {
    if (!inputActivo) return;
    const el = inputActivo;
    if (itemsActuales[idx] !== undefined) {
      el.value = itemsActuales[idx];
      // Si es una casilla editable de la matriz en bruto, guardamos de inmediato en Firestore
      if (el.dataset.hash && el.dataset.idtrat && el.dataset.campo) {
        window.guardarCeldaMatrizQF(el.dataset.hash, el.dataset.idtrat, el.dataset.campo, el.value);
      } else {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    popup.style.display = "none";
    avanzarAlSiguienteCampo(el);
  }

  function avanzarAlSiguienteCampo(elementoActual) {
    const contenedorRaiz = elementoActual.closest("#modal-visacion-qf") || document.getElementById("cuerpo-formulario-ingreso");
    if (!contenedorRaiz) return;

    // Solo navega por campos con clase .nav-field (se salta la fecha automáticamente)
    const camposNavegables = Array.from(contenedorRaiz.querySelectorAll(".nav-field:not([disabled])"));
    const idxActual = camposNavegables.indexOf(elementoActual);

    if (idxActual !== -1 && idxActual + 1 < camposNavegables.length) {
      const siguiente = camposNavegables[idxActual + 1];
      siguiente.focus();
      if (siguiente.select) siguiente.select();
    }
  }

  document.addEventListener("focusin", (e) => {
    const target = e.target;
    if (target.dataset && target.dataset.ac) {
      inputActivo = target;
      renderizarOpciones(target);
    } else {
      popup.style.display = "none";
    }
  });

  document.addEventListener("input", (e) => {
    const target = e.target;
    if (target.dataset && target.dataset.ac) {
      inputActivo = target;
      renderizarOpciones(target);
    }
  });

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    if (!target.classList || !target.classList.contains("nav-field")) return;
    const dropRut = document.getElementById("dropdown-sugerencias");
    if (target.id === "in-rut" && dropRut && dropRut.style.display === "block") return;

    const menuAbierto = popup.style.display === "block" && inputActivo === target && itemsActuales.length > 0;

    if (e.key === "ArrowDown" && menuAbierto) {
      e.preventDefault();
      indiceSeleccionado = (indiceSeleccionado + 1) % itemsActuales.length;
      actualizarVistaItems();
    } else if (e.key === "ArrowUp" && menuAbierto) {
      e.preventDefault();
      indiceSeleccionado = (indiceSeleccionado - 1 + itemsActuales.length) % itemsActuales.length;
      actualizarVistaItems();
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Si el foco está en un botón (.btn-add-med o .btn-registrar-proa):
      // - Enter ejecuta el clic del botón (agrega fila o guarda paciente)
      // - Tab avanza al siguiente botón
      if (target.tagName === "BUTTON") {
        if (e.key === "Enter") {
          e.preventDefault();
          target.click();
        } else if (e.key === "Tab") {
          e.preventDefault();
          avanzarAlSiguienteCampo(target);
        }
        return;
      }

      if (menuAbierto) {
        e.preventDefault();
        seleccionarYAvanzar(indiceSeleccionado);
      } else {
        e.preventDefault();
        popup.style.display = "none";
        avanzarAlSiguienteCampo(target);
      }
    } else if (e.key === "Escape" && menuAbierto) {
      popup.style.display = "none";
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target !== inputActivo && !popup.contains(e.target)) {
      popup.style.display = "none";
    }
  });
}

// 2. GESTIÓN DE FILAS MÚLTIPLES EN INGRESO TENS
window.agregarFilaMedicamento = function(enfocarNuevo = false) {
  const contenedor = document.getElementById("contenedor-filas-medicamentos");
  const div = document.createElement("div");
  div.className = "med-row";
  div.innerHTML = `
    <div class="field-group">
      <label>ESTADO</label>
      <select class="estado-select-pill med-estado nav-field">
        <option value="SOLICITUD">SOLICITUD</option>
        <option value="APROBADO">APROBADO</option>
        <option value="RECHAZADO">RECHAZADO</option>
      </select>
    </div>
    <div class="field-group">
      <label>ANTIBIÓTICO</label>
      <input type="text" data-ac="antimicrobianos" class="proa-input med-atb nav-field" placeholder="Buscar..." autocomplete="off">
    </div>
    <div class="field-group">
      <label>CARGA</label>
      <select class="proa-select med-carga nav-field">
        <option value="NO">NO</option>
        <option value="SI">SI</option>
      </select>
    </div>
    <div class="field-group">
      <label>DOSIS</label>
      <input type="text" data-ac="dosis" class="proa-input med-dosis nav-field" placeholder="Buscar..." autocomplete="off">
    </div>
    <div class="field-group">
      <label>FRECUENCIA</label>
      <input type="text" data-ac="frecuencias" class="proa-input med-frec nav-field" placeholder="Buscar..." autocomplete="off">
    </div>
    <button type="button" class="btn-trash" title="Eliminar medicamento" onclick="eliminarFilaMedicamento(this)">
      <span class="material-icons-round" style="font-size: 18px;">delete</span>
    </button>
  `;
  contenedor.appendChild(div);

  aplicarPermisosSegunRolUI();
  if (enfocarNuevo) {
    const inputAtb = div.querySelector(".med-atb");
    if (inputAtb) inputAtb.focus();
  }
};

window.eliminarFilaMedicamento = function(btn) {
  const filas = document.querySelectorAll(".med-row");
  if (filas.length > 1) btn.closest(".med-row").remove();
};

window.toggleMinimizarIngreso = function() {
  const body = document.getElementById("cuerpo-formulario-ingreso");
  const btn = document.getElementById("btn-minimizar-ingreso");
  const estaMinimizado = body.classList.toggle("minimizado");

  if (btn) {
    btn.innerText = estaMinimizado ? "+" : "−";
    btn.title = estaMinimizado ? "Expandir Panel de Ingreso" : "Minimizar Panel de Ingreso";
    btn.style.transform = estaMinimizado ? "rotate(90deg)" : "rotate(0deg)";
  }
};

// 3. AUTOCOMPLETADO EN INGRESO CON AUTO-GUIÓN Y SOPORTE DE FLECHAS + ENTER/TAB
let SUGERENCIAS_RUT_ACTUALES = [];
let INDICE_SUG_RUT = 0;

function formatearRutConGuionAutomatico(valorRaw) {
  const limpio = valorRaw.trim().toUpperCase();
  if (limpio === "S" || limpio === "S/" || limpio === "S/R" || limpio === "NN") return limpio;

  // Si empieza con números y solo contiene dígitos o K, aplicamos auto-guión
  if (/^[0-9]+[0-9K]*$/.test(limpio.replace(/-/g, ""))) {
    const soloAlfanum = limpio.replace(/[^0-9K]/g, "").slice(0, 9);
    if (soloAlfanum.length >= 2) {
      return soloAlfanum.slice(0, -1) + "-" + soloAlfanum.slice(-1);
    }
    return soloAlfanum;
  }
  return valorRaw;
}

window.alEscribirRutONombre = function(input) {
  // Aplicar auto-guión si está digitando un RUT
  const valorFormateado = formatearRutConGuionAutomatico(input.value);
  if (input.value !== valorFormateado) {
    input.value = valorFormateado;
  }

  const val = input.value.trim().toUpperCase();
  const valSinGuion = val.replace(/-/g, "");
  const drop = document.getElementById("dropdown-sugerencias");

  if (val.length < 2) {
    drop.style.display = "none";
    SUGERENCIAS_RUT_ACTUALES = [];
    return;
  }

  const mapaUnicos = {};
  MEMORIA_FILAS.forEach(f => {
    if (!mapaUnicos[f.rut]) mapaUnicos[f.rut] = f;
  });

  SUGERENCIAS_RUT_ACTUALES = Object.values(mapaUnicos).filter(p =>
    p.rut.toUpperCase().includes(val) ||
    p.rut.toUpperCase().replace(/-/g, "").includes(valSinGuion) ||
    p.nombre.toUpperCase().includes(val) ||
    p.apellido.toUpperCase().includes(val)
  ).slice(0, 6);

  if (!SUGERENCIAS_RUT_ACTUALES.length) {
    drop.style.display = "none";
    return;
  }

  INDICE_SUG_RUT = 0;
  renderizarDropdownSugerenciasRut();
  drop.style.display = "block";
};

function renderizarDropdownSugerenciasRut() {
  const drop = document.getElementById("dropdown-sugerencias");
  drop.innerHTML = SUGERENCIAS_RUT_ACTUALES.map((p, idx) => `
    <div class="sug-item ${idx === INDICE_SUG_RUT ? "sug-active" : ""}"
         onmousedown=" event.preventDefault(); seleccionarPacienteSugeridoPorIndice(${idx}); ">
      <b>${p.rut}</b> — ${p.nombre} ${p.apellido} <span style="color:#64748b;">(${p.servicio} • Cama: ${p.cama})</span>
    </div>
  `).join("");
}

window.manejarTecladoSugerenciasRut = function(e) {
  const drop = document.getElementById("dropdown-sugerencias");
  if (!drop || drop.style.display !== "block" || !SUGERENCIAS_RUT_ACTUALES.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    INDICE_SUG_RUT = (INDICE_SUG_RUT + 1) % SUGERENCIAS_RUT_ACTUALES.length;
    renderizarDropdownSugerenciasRut();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    INDICE_SUG_RUT = (INDICE_SUG_RUT - 1 + SUGERENCIAS_RUT_ACTUALES.length) % SUGERENCIAS_RUT_ACTUALES.length;
    renderizarDropdownSugerenciasRut();
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    seleccionarPacienteSugeridoPorIndice(INDICE_SUG_RUT);
  } else if (e.key === "Escape") {
    drop.style.display = "none";
  }
};

window.seleccionarPacienteSugeridoPorIndice = function(idx) {
  const p = SUGERENCIAS_RUT_ACTUALES[idx];
  if (!p) return;
  seleccionarPacienteSugerido(p.rut, p.nombre, p.apellido, p.servicio, p.cama);
};

window.seleccionarPacienteSugerido = function(rut, nombre, apellido, servicio, cama) {
  document.getElementById("in-rut").value = rut;
  document.getElementById("in-nombres").value = nombre;
  document.getElementById("in-apellidos").value = apellido;
  document.getElementById("in-servicio").value = servicio;
  document.getElementById("in-cama").value = cama;
  document.getElementById("dropdown-sugerencias").style.display = "none";
  SUGERENCIAS_RUT_ACTUALES = [];

  // Si ya hay digitador, salta directo al primer antibiótico; si no, salta a Digitador
  const inputDig = document.getElementById("in-digitador");
  const primerAtb = document.querySelector(".med-atb");
  if (inputDig && !inputDig.value.trim()) {
    inputDig.focus();
  } else if (primerAtb) {
    primerAtb.focus();
  }
};

window.seleccionarPacienteSugerido = function(rut, nombre, apellido, servicio, cama) {
  document.getElementById("in-rut").value = rut;
  document.getElementById("in-nombres").value = nombre;
  document.getElementById("in-apellidos").value = apellido;
  document.getElementById("in-servicio").value = servicio;
  document.getElementById("in-cama").value = cama;
  document.getElementById("dropdown-sugerencias").style.display = "none";
};

// FUNCIONES DE MODAL VISUAL (¡INGRESO EXITOSO! Y ERROR)
window.mostrarModalFeedback = function(tipo, titulo, mensaje, autoCerrarMs = 0) {
  const modal = document.getElementById("modal-feedback-proa");
  const iconBox = document.getElementById("feedback-icon-box");
  const iconSym = document.getElementById("feedback-icon-symbol");
  const titleEl = document.getElementById("feedback-title-txt");
  const descEl = document.getElementById("feedback-desc-txt");
  const btnOk = document.getElementById("feedback-btn-ok");

  titleEl.innerText = titulo;
  descEl.innerText = mensaje;

  if (tipo === "SUCCESS") {
    iconBox.className = "feedback-icon-circle icon-circle-success";
    iconSym.innerText = "check";
    btnOk.style.display = "none";
  } else {
    iconBox.className = "feedback-icon-circle icon-circle-error";
    iconSym.innerText = "close";
    btnOk.style.display = "inline-block";
  }

  modal.style.display = "flex";

  if (autoCerrarMs > 0) {
    setTimeout(() => {
      modal.style.display = "none";
    }, autoCerrarMs);
  }
};

window.cerrarModalFeedback = function() {
  document.getElementById("modal-feedback-proa").style.display = "none";
};

// 4. REGISTRAR EN PROA CON MODAL DE ÉXITO Y ERROR
window.registrarEnProa = async function() {
  const rut = document.getElementById("in-rut").value.trim();
  const nombre = document.getElementById("in-nombres").value.trim();
  const apellido = document.getElementById("in-apellidos").value.trim();
  const servicio = document.getElementById("in-servicio").value.trim();
  const cama = document.getElementById("in-cama").value.trim() || "S/I";
  const fechaISO = document.getElementById("in-fecha").value;
  const digitador = document.getElementById("in-digitador").value.trim() || PERFIL_ACTUAL.nombre || "FRANCISCO BARRA";

  if (!rut || !nombre || !servicio) {
    mostrarModalFeedback(
      "ERROR",
      "Error",
      "Faltan datos obligatorios del paciente: verifique RUT, Nombres y Servicio Actual."
    );
    return;
  }

  const filasMed = document.querySelectorAll(".med-row");
  const tratamientos = [];
  filasMed.forEach(row => {
    const med = row.querySelector(".med-atb").value.trim();
    if (med) {
      tratamientos.push({
        estado: row.querySelector(".med-estado").value,
        medicamento: med,
        carga: row.querySelector(".med-carga").value,
        dosis: row.querySelector(".med-dosis").value.trim() || "S/D",
        frecuencia: row.querySelector(".med-frec").value.trim() || "24 HRS"
      });
    }
  });

  if (!tratamientos.length) {
    mostrarModalFeedback(
      "ERROR",
      "Error",
      "Debe ingresar al menos un antibiótico válido en el esquema de prescripción."
    );
    return;
  }

  const btnSubmit = document.getElementById("btn-submit-ingreso");
  const pill = document.getElementById("status-ingreso-pill");
  const htmlOriginalBtn = btnSubmit.innerHTML;

  try {
    btnSubmit.innerHTML = `<span class="material-icons-round" style="font-size: 19px;">sync</span> <span>Sincronizando...</span>`;
    btnSubmit.disabled = true;
    pill.innerHTML = `<span>⏳ Sincronizando con Firestore...</span>`;

    const [y, m, d] = fechaISO.split("-");
    const fechaCL = `${d}/${m}/${y}`;

    await registrarIngresoMultipleCifrado({
      rut, nombre, apellido, servicio, cama, fecha: fechaCL, digitador, tratamientos
    });

    // Mostrar modal idéntico a PROA 3.3: "¡Ingreso Exitoso! Se registraron X medicamentos."
    mostrarModalFeedback(
      "SUCCESS",
      "¡Ingreso Exitoso!",
      `Se registraron ${tratamientos.length} medicamentos.`,
      1900
    );

    await registrarNotificacionPROA(
      `${digitador} ingresó ${tratamientos.length} tratamiento(s) para el paciente ${nombre.toUpperCase()} ${apellido.toUpperCase()} en ${servicio.toUpperCase()}.`,
      "INGRESO"
    );

    document.getElementById("in-rut").value = "";
    document.getElementById("in-nombres").value = "";
    document.getElementById("in-apellidos").value = "";
    document.getElementById("in-cama").value = "";
    document.getElementById("contenedor-filas-medicamentos").innerHTML = "";
    agregarFilaMedicamento();

    pill.innerHTML = `<span>● Sistema Listo</span> <span style="font-weight:500;">| Guardado exitoso ✓</span>`;
    await cargarMatrizEnVivo();
    await cargarNotificacionesEnVivo();
  } catch (err) {
    mostrarModalFeedback("ERROR", "Error", "Error en inyección: " + err.message);
  } finally {
    btnSubmit.innerHTML = htmlOriginalBtn;
    btnSubmit.disabled = false;
  }
};

// 5. CÁLCULO MATEMÁTICO DE VIGENCIA Y PLAZOS
function parsearFechaCL(str) {
  if (!str) return new Date();
  if (str.includes("/")) {
    const [d, m, y] = str.split("/");
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  if (str.includes("-")) {
    const [y, m, d] = str.split("-");
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(str);
}

function calcularMetricasFila(f) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fIni = parsearFechaCL(f.fecha_inicio);
  fIni.setHours(0, 0, 0, 0);

  const diasTranscurridos = Math.max(0, Math.floor((hoy - fIni) / 86400000));
  const diasLleva = diasTranscurridos + 1;
  const est = (f.estado || "SOLICITUD").toUpperCase();
  const esCarga = String(f.carga || "NO").toUpperCase() === "SI";

  // 1. REGLA DE TIEMPO DE GRACIA:
  // - Si está RECHAZADO o APROBADO/AUTORIZADO -> T. Gracia pasa a -1 (manda T. Autorización)
  // - Si es Dosis de Carga (CARGA = SI) -> Día 0 muestra 0 (dosis única), luego pasa a -1
  let tGracia;
  if (est === "RECHAZADO" || est === "APROBADO" || est === "AUTORIZADO") {
    tGracia = -1;
  } else if (esCarga) {
    tGracia = 0 - diasTranscurridos;
  } else {
    tGracia = (f.dias_predeterminados - 1) - diasTranscurridos;
  }

  // 2. REGLA DE TIEMPO DE AUTORIZACIÓN:
  const diasAut = f.dias_autorizacion ? Number(f.dias_autorizacion) : 0;
  let tAut;
  if (est === "RECHAZADO") {
    tAut = -1;
  } else if (esCarga && (est === "APROBADO" || est === "AUTORIZADO")) {
    tAut = 0 - diasTranscurridos;
  } else {
    tAut = diasAut > 0 ? (diasAut - 1) - diasTranscurridos : -1 - diasTranscurridos;
  }

  // 3. VIGENCIA Y DÍAS RESTANTES:
  const esAprobado = (est === "APROBADO" || est === "AUTORIZADO");
  const contadorActivo = esAprobado ? tAut : tGracia;
  const diasRestantesReales = Math.max(0, contadorActivo + 1);

  const esVigente = (est === "RECHAZADO" || f.conducta === "SUSPENDIDO")
    ? false
    : (contadorActivo >= 0);

  return { fIni, diasLleva, tGracia, tAut, diasRestantesReales, esVigente, esCarga, contadorActivo };
}

// 6. MATRIZ Y BARRA LATERAL
window.cargarMatrizEnVivo = async function() {
  MEMORIA_FILAS = await obtenerMatrizCompletaDescifrada();
  document.getElementById("contador-matriz").innerText = `${MEMORIA_FILAS.length} registros`;
  renderizarTablaMatriz();
  renderizarBarraLateral();
};

window.limpiarFiltrosMatriz = function() {
  document.getElementById("filtro-matriz-ventana").value = "TODOS";
  document.getElementById("filtro-matriz-estado").value = "TODOS";
  document.getElementById("filtro-matriz-servicio").value = "TODOS";
  document.getElementById("filtro-matriz-texto").value = "";
  renderizarTablaMatriz();
};

window.renderizarTablaMatriz = function() {
  const tbody = document.getElementById("proa-tbody");
  if (!MEMORIA_FILAS.length) {
    tbody.innerHTML = `<tr><td colspan="25" style="text-align:center; padding:20px;">Sin registros en la base de datos.</td></tr>`;
    document.getElementById("contador-matriz").innerText = "0 registros";
    return;
  }

  const ventana = document.getElementById("filtro-matriz-ventana")?.value || "ACTIVOS_7D";
  const filtroEst = document.getElementById("filtro-matriz-estado")?.value || "TODOS";
  const filtroSrv = document.getElementById("filtro-matriz-servicio")?.value || "TODOS";
  const orden = document.getElementById("filtro-matriz-orden")?.value || "ASC";
  const texto = (document.getElementById("filtro-matriz-texto")?.value || "").trim().toUpperCase();

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  // 1. Filtrar localmente en memoria (sin afectar a otros usuarios)
  let filasFiltradas = MEMORIA_FILAS.filter(f => {
    const m = calcularMetricasFila(f);
    const diasAntiguedad = Math.floor((hoy - m.fIni) / 86400000);

    if (ventana === "SOLO_VIGENTES" && !m.esVigente) return false;
    if (ventana === "ACTIVOS_7D" && !m.esVigente && diasAntiguedad > 7) return false;
    if (ventana === "ULTIMOS_30D" && !m.esVigente && diasAntiguedad > 30) return false;

    if (filtroEst !== "TODOS" && f.estado.toUpperCase() !== filtroEst) return false;
    if (filtroSrv !== "TODOS" && f.servicio.toUpperCase() !== filtroSrv) return false;

    if (texto) {
      const bloqueBusqueda = `${f.rut} ${f.nombre} ${f.apellido} ${f.servicio} ${f.cama} ${f.antimicrobiano} ${f.diagnostico} ${f.visador} ${f.digitador}`.toUpperCase();
      if (!bloqueBusqueda.includes(texto)) return false;
    }
    return true;
  });

  // 2. Ordenar cronológicamente por Fecha de Inicio y luego por instante de creación (creado_ms)
  filasFiltradas.sort((a, b) => {
    const timeA = parsearFechaCL(a.fecha_inicio).getTime();
    const timeB = parsearFechaCL(b.fecha_inicio).getTime();
    if (timeA !== timeB) {
      return orden === "ASC" ? timeA - timeB : timeB - timeA;
    }
    const msA = a.creado_ms || 0;
    const msB = b.creado_ms || 0;
    return orden === "ASC" ? msA - msB : msB - msA;
  });

  document.getElementById("contador-matriz").innerText =
    `${filasFiltradas.length} de ${MEMORIA_FILAS.length} registros`;

  if (!filasFiltradas.length) {
    tbody.innerHTML = `<tr><td colspan="25" style="text-align:center; padding:20px; color:#64748b;">No hay registros que coincidan con el filtro seleccionado.</td></tr>`;
    return;
  }

  const esQF = PERFIL_ACTUAL.rol === "QF";

  tbody.innerHTML = filasFiltradas.map(f => {
    const m = calcularMetricasFila(f);
    const semG = m.tGracia >= 0 ? "sem-verde" : "sem-rojo";
    const semA = m.tAut >= 0 ? "sem-verde" : "sem-rojo";
    const estUpper = f.estado.toUpperCase();
    const diasVal = f.dias_autorizacion !== null && f.dias_autorizacion !== undefined ? f.dias_autorizacion : "";

    // Color de fondo de la celda ESTADO idéntico a Google Sheets
    const claseColorEstado = estUpper === "APROBADO"
      ? "est-sheet-aprobado"
      : estUpper === "RECHAZADO" ? "est-sheet-rechazado" : "est-sheet-solicitud";

    const celdaEstadoHTML = esQF
      ? `<select class="matrix-inline-select" onchange="guardarCeldaMatrizQF('${f.hashPaciente}', '${f.idTratamiento}', 'estado', this.value)">
           <option value="SOLICITUD" ${estUpper === "SOLICITUD" ? "selected" : ""}>SOLICITUD</option>
           <option value="APROBADO" ${estUpper === "APROBADO" ? "selected" : ""}>APROBADO</option>
           <option value="RECHAZADO" ${estUpper === "RECHAZADO" ? "selected" : ""}>RECHAZADO</option>
         </select>`
      : `<span>${estUpper}</span>`;

    // Limpieza visual para que nunca se muestre BARRA.FRANCISCO30 en visador ni digitador
    const limpiarNombre = (nom) => {
      if (!nom) return "";
      return String(nom).toUpperCase() === "BARRA.FRANCISCO30" ? "FRANCISCO BARRA" : nom;
    };
    f.digitador = limpiarNombre(f.digitador);
    f.visador = limpiarNombre(f.visador);

    // Helper para generar casillas auto-ajustables en ancho y conectadas en tiempo real con la cuenta TENS
    const celdaEditableQF = (campo, valor, catalogoAC = "", minAncho = 135) => {
      const valLimpio = limpiarNombre(valor || "");
      const valSeguro = String(valLimpio).replace(/"/g, "&quot;");
      if (!esQF) return `<span style="padding: 0 4px;">${valSeguro}</span>`;

      const anchoCalculado = Math.max(minAncho, valLimpio.length * 7.6 + 24);
      const attrAC = catalogoAC ? `data-ac="${catalogoAC}"` : "";
      return `<input type="text" class="matrix-editable-input nav-field"
                     style="min-width: ${anchoCalculado}px;"
                     ${attrAC}
                     data-hash="${f.hashPaciente}"
                     data-idtrat="${f.idTratamiento}"
                     data-campo="${campo}"
                     value="${valSeguro}"
                     onchange="guardarCeldaMatrizQF('${f.hashPaciente}', '${f.idTratamiento}', '${campo}', this.value)">`;
    };

    const celdaDiasAutHTML = esQF
      ? `<input type="number" class="matrix-inline-days" value="${diasVal}" placeholder="-"
                onchange="guardarCeldaMatrizQF('${f.hashPaciente}', '${f.idTratamiento}', 'dias_autorizacion', this.value)">`
      : `<b>${diasVal}</b>`;

    return `
      <tr>
        <td class="td-estado-cell ${claseColorEstado}">${celdaEstadoHTML}</td>
        <td class="td-azul">${f.antimicrobiano}</td>
        <td class="td-azul" style="text-align:center;">${f.carga}</td>
        <td class="td-azul">${f.dosis}</td>
        <td class="td-azul">${f.frecuencia}</td>
        <td class="td-azul">${f.fecha_inicio}</td>
        <td class="semaforo ${semG}">${m.tGracia}</td>
        <td class="semaforo ${semA}">${m.tAut}</td>
        <td class="td-azul">${f.servicio}</td>
        <td class="td-azul">${f.cama}</td>
        <td class="td-azul">${f.nombre}</td>
        <td class="td-azul">${f.apellido}</td>
        <td class="td-azul">${f.rut}</td>
        <td class="td-azul">${f.digitador}</td>
        <!-- ZONA VERDE EDITABLE (W a Z) -->
        <td class="td-verde">${celdaEditableQF("diagnostico", f.diagnostico, "diagnosticos")}</td>
        <td class="td-verde">${celdaEditableQF("tipo_tratamiento", f.tipo_tratamiento, "tipoTto")}</td>
        <td class="td-verde">${celdaEditableQF("tipo_terapia", f.tipo_terapia, "tipoTerapia")}</td>
        <td class="td-verde">${celdaEditableQF("lugar_infeccion", f.lugar_infeccion, "lugarInf")}</td>
        <!-- ZONA AMARILLA EDITABLE (AA a AG) -->
        <td class="td-amarilla">${celdaEditableQF("conducta", f.conducta, "estadoClinico")}</td>
        <td class="td-amarilla" style="text-align:center;">${celdaDiasAutHTML}</td>
        <td class="td-amarilla">${celdaEditableQF("uso_adecuado", f.uso_adecuado, "usoAdecuado")}</td>
        <td class="td-amarilla">${celdaEditableQF("observaciones", f.observaciones, "")}</td>
        <td class="td-amarilla">${celdaEditableQF("visador", f.visador, "visadores")}</td>
        <td class="td-amarilla">${celdaEditableQF("fecha_visado", f.fecha_visado, "")}</td>
        <td class="td-amarilla">${celdaEditableQF("paciente_no_encontrado", f.paciente_no_encontrado, "pacNoEncontrado")}</td>
      </tr>
    `;
  }).join("");
};

// Guarda cualquier celda editada en la Matriz Bruta (Estado, Días, Zona Verde o Zona Amarilla)
window.guardarCeldaMatrizQF = async function(hashPaciente, idTratamiento, campo, nuevoValor) {
  if (PERFIL_ACTUAL.rol !== "QF") return;
  const fila = MEMORIA_FILAS.find(x => x.hashPaciente === hashPaciente && x.idTratamiento === idTratamiento);
  if (!fila) return;

  const nombreQF = PERFIL_ACTUAL.nombre || "FRANCISCO BARRA";
  const hoyCL = hoyFormateadoCL();
  const camposUpdate = {};
  let bovedaClinicaNueva = null;

  if (campo === "estado") {
    const estNuevo = nuevoValor.toUpperCase();
    camposUpdate.estado = estNuevo;
    camposUpdate.visador = fila.visador || nombreQF;
    camposUpdate.fecha_visado = fila.fecha_visado || hoyCL;

    if (estNuevo === "APROBADO") {
      camposUpdate.conducta = fila.conducta || "AUTORIZADO";
      if (!fila.dias_autorizacion || Number(fila.dias_autorizacion) <= 0) {
        const pedir = prompt(`Ingrese los días de aprobación para ${fila.antimicrobiano} (${fila.nombre} ${fila.apellido}):`, "7");
        if (pedir === null) { renderizarTablaMatriz(); return; }
        camposUpdate.dias_autorizacion = Number(pedir) || 7;
      }
    } else if (estNuevo === "RECHAZADO") {
      camposUpdate.conducta = "SUSPENDIDO";
    }
  } else if (campo === "dias_autorizacion") {
    camposUpdate.dias_autorizacion = nuevoValor !== "" ? Number(nuevoValor) : null;
    camposUpdate.visador = fila.visador || nombreQF;
    camposUpdate.fecha_visado = fila.fecha_visado || hoyCL;
  } else if (campo === "diagnostico" || campo === "observaciones") {
    bovedaClinicaNueva = {
      diagnostico: campo === "diagnostico" ? nuevoValor.trim().toUpperCase() : (fila.diagnostico || ""),
      observaciones: campo === "observaciones" ? nuevoValor.trim() : (fila.observaciones || "")
    };
    camposUpdate.visador = fila.visador || nombreQF;
    camposUpdate.fecha_visado = fila.fecha_visado || hoyCL;
  } else {
    camposUpdate[campo] = nuevoValor.trim();
    if (!fila.visador) camposUpdate.visador = nombreQF;
    if (!fila.fecha_visado) camposUpdate.fecha_visado = hoyCL;
  }

  await actualizarRapidoDesdeMatriz(hashPaciente, idTratamiento, camposUpdate, bovedaClinicaNueva);

  // Generar notificación descriptiva
  const descCampo = campo.replace(/_/g, " ").toUpperCase();
  const msg = campo === "estado"
    ? `QF ${nombreQF} cambió el estado de ${fila.nombre} ${fila.apellido} (${fila.antimicrobiano}) a ${camposUpdate.estado}${camposUpdate.dias_autorizacion ? " por " + camposUpdate.dias_autorizacion + " días" : ""}.`
    : `QF ${nombreQF} actualizó ${descCampo} ("${nuevoValor}") en el paciente ${fila.nombre} ${fila.apellido} (${fila.antimicrobiano}).`;

  await registrarNotificacionPROA(msg, "MATRIZ_QF");
  await cargarMatrizEnVivo();
  await cargarNotificacionesEnVivo();
};

// Guarda al instante el cambio hecho por el QF en la Matriz Bruta y genera la notificación
window.cambioRapidoMatrizQF = async function(hashPaciente, idTratamiento, nuevoEstado, nuevosDias) {
  if (PERFIL_ACTUAL.rol !== "QF") return;
  const fila = MEMORIA_FILAS.find(x => x.hashPaciente === hashPaciente && x.idTratamiento === idTratamiento);
  if (!fila) return;

  const estadoAnterior = fila.estado.toUpperCase();
  let diasFinales = nuevosDias;

  // Si pasa a APROBADO desde la tabla y no tenía días puestos, sugerimos 7 días o preguntamos
  if (nuevoEstado === "APROBADO" && (diasFinales === "" || diasFinales === null || Number(diasFinales) <= 0)) {
    const pedirDias = prompt(`Ingrese los días de aprobación para ${fila.antimicrobiano} (${fila.nombre} ${fila.apellido}):`, "7");
    if (pedirDias === null) {
      renderizarTablaMatriz();
      return;
    }
    diasFinales = Number(pedirDias) || 7;
  }

  const nombreQF = PERFIL_ACTUAL.nombre || "QF";
  await actualizarRapidoDesdeMatriz(hashPaciente, idTratamiento, nuevoEstado, diasFinales, nombreQF);

  const textoDias = nuevoEstado === "APROBADO" ? ` por ${diasFinales} días` : "";
  const msgNotif = `QF ${nombreQF} cambió el estado del paciente ${fila.nombre} ${fila.apellido} (${fila.antimicrobiano}) de ${estadoAnterior} a ${nuevoEstado}${textoDias}.`;
  await registrarNotificacionPROA(msgNotif, "VISACION");

  await cargarMatrizEnVivo();
  await cargarNotificacionesEnVivo();
};

function iniciarCarruselAutomaticoSidebar() {
  if (TIMER_CARRUSEL_SIDEBAR) clearInterval(TIMER_CARRUSEL_SIDEBAR);
  TIMER_CARRUSEL_SIDEBAR = setInterval(() => {
    const queryTxt = (document.getElementById("input-buscador-lateral")?.value || "").trim();
    if (MODO_SIDEBAR === "PACIENTES" && !queryTxt && !VER_LISTA_PACIENTES_SIDEBAR) {
      INDICE_CARRUSEL_SRV++;
      renderizarBarraLateral();
    }
  }, 5000);
}

window.cambiarServicioCarruselManual = function(idx) {
  INDICE_CARRUSEL_SRV = idx;
  renderizarBarraLateral();
};

window.toggleVerListaPacientesSidebar = function() {
  VER_LISTA_PACIENTES_SIDEBAR = !VER_LISTA_PACIENTES_SIDEBAR;
  renderizarBarraLateral();
};

window.renderizarBarraLateral = function() {
  const queryTxt = (document.getElementById("input-buscador-lateral").value || "").trim().toUpperCase();
  const contenedor = document.getElementById("contenedor-tarjetas-buscador");
  const contChips = document.getElementById("contenedor-chips-servicios");
  const esQF = PERFIL_ACTUAL.rol === "QF";

  // Si estamos en modo PACIENTES, sin búsqueda escrita y en modo Monitor Vivo -> Mostrar Carrusel 5 seg (Imagen 4)
  if (MODO_SIDEBAR === "PACIENTES" && !queryTxt && !VER_LISTA_PACIENTES_SIDEBAR && MEMORIA_FILAS.length > 0) {
    if (contChips) contChips.style.display = "none";

    // Obtener servicios que tienen registros
    const serviciosConDatos = Array.from(new Set(MEMORIA_FILAS.map(f => (f.servicio || "SIN SERVICIO").toUpperCase()))).sort();
    if (serviciosConDatos.length === 0) serviciosConDatos.push("URG ADULTO");

    const idxActual = INDICE_CARRUSEL_SRV % serviciosConDatos.length;
    const srvActual = serviciosConDatos[idxActual];
    const filasDelSrv = MEMORIA_FILAS.filter(f => (f.servicio || "").toUpperCase() === srvActual);

    let contUltimoDia = 0;
    let contPorVisar = 0;
    let contActivos = 0;
    const conteoAtb = {};

    filasDelSrv.forEach(f => {
      const m = calcularMetricasFila(f);
      if (f.estado.toUpperCase() === "SOLICITUD") contPorVisar++;
      if (m.esVigente) {
        contActivos++;
        if (m.contadorActivo === 0 || m.esCarga) contUltimoDia++;
      }
      if (f.antimicrobiano) {
        conteoAtb[f.antimicrobiano] = (conteoAtb[f.antimicrobiano] || 0) + 1;
      }
    });

    const top3Atb = Object.entries(conteoAtb)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    document.getElementById("texto-coincidencias").innerHTML = `
      <span>Monitor en vivo • Rotación 5s</span> •
      <a onclick="toggleVerListaPacientesSidebar()" style="color:#0066ff; cursor:pointer; font-weight:800;">Ver todos los pacientes (${MEMORIA_FILAS.length})</a>
    `;

    const dotsHTML = serviciosConDatos.map((s, i) => `
      <span class="live-dot ${i === idxActual ? "active" : ""}" title="${s}" onclick="cambiarServicioCarruselManual(${i})"></span>
    `).join("");

    const rankingHTML = top3Atb.length > 0
      ? top3Atb.map(([nombreAtb, cant], i) => `
          <div class="ranking-item-row">
            <div class="ranking-atb-name">
              <span style="color:#94a3b8;">${i + 1}.</span>
              <span>${nombreAtb}</span>
            </div>
            <span class="ranking-pill-count">${cant}</span>
          </div>
        `).join("")
      : `<div style="font-size:11px; color:#94a3b8; text-align:center; padding:8px;">Sin antimicrobianos en este servicio</div>`;

    contenedor.innerHTML = `
      <div class="live-dashboard-wrap">
        <div class="live-srv-header">
          <div class="live-srv-title">
            <span class="material-icons-round" style="font-size:19px;">meeting_room</span>
            <span>${srvActual}</span>
          </div>
          <div class="live-dots-row">${dotsHTML}</div>
        </div>

        <div class="live-kpi-grid">
          <div class="live-kpi-card" onclick="irAServicioDesdeMonitor('${srvActual}')">
            <div class="kpi-icon-box kpi-icon-red">
              <span class="material-icons-round">event_busy</span>
            </div>
            <div class="kpi-big-num" style="color:#ef4444;">${contUltimoDia}</div>
            <div class="kpi-label">Último Día</div>
          </div>

          <div class="live-kpi-card" onclick="irAServicioDesdeMonitor('${srvActual}')">
            <div class="kpi-icon-box kpi-icon-orange">
              <span class="material-icons-round">schedule</span>
            </div>
            <div class="kpi-big-num" style="color:#f59e0b;">${contPorVisar}</div>
            <div class="kpi-label">Por Visar</div>
          </div>
        </div>

        <div class="live-activos-banner" onclick="irAServicioDesdeMonitor('${srvActual}')">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="kpi-icon-box kpi-icon-green">
              <span class="material-icons-round">verified_user</span>
            </div>
            <span style="font-size:13px; font-weight:700; color:#64748b;">Tratamientos Activos</span>
          </div>
          <span style="font-size:28px; font-weight:800; color:#22c55e;">${contActivos}</span>
        </div>

        <div class="live-ranking-card">
          <div class="live-ranking-header">
            <span class="material-icons-round" style="color:#0066ff; font-size:15px;">insights</span>
            <span>RANKING ANTIMICROBIANOS</span>
          </div>
          ${rankingHTML}
        </div>
      </div>
    `;
    return;
  }

  // MODO LISTA DE PACIENTES O PESTAÑA SERVICIOS
  const pacientesMap = {};
  MEMORIA_FILAS.forEach(f => {
    const key = f.hashPaciente || f.rut;
    if (!pacientesMap[key]) {
      pacientesMap[key] = {
        key,
        rut: f.rut,
        nombreCompleto: `${f.nombre} ${f.apellido}`.trim(),
        servicio: f.servicio,
        cama: f.cama,
        filas: []
      };
    }
    pacientesMap[key].filas.push(f);
  });

  const todosLosPacientes = Object.values(pacientesMap);

  if (contChips) {
    if (MODO_SIDEBAR === "SERVICIOS") {
      contChips.style.display = "flex";
      const conteoPorSrv = {};
      todosLosPacientes.forEach(p => {
        const s = (p.servicio || "SIN SERVICIO").toUpperCase();
        conteoPorSrv[s] = (conteoPorSrv[s] || 0) + 1;
      });

      const listaServicios = CATALOGOS_MEMORIA.servicios && CATALOGOS_MEMORIA.servicios.length
        ? CATALOGOS_MEMORIA.servicios
        : Object.keys(conteoPorSrv).sort();

      let htmlChips = `
        <button type="button" class="srv-chip ${SERVICIO_SELECCIONADO_SIDEBAR === "TODOS" ? "active" : ""}" onclick="seleccionarServicioSidebar('TODOS')">
          <span>TODOS</span>
          <span class="srv-chip-count">${todosLosPacientes.length}</span>
        </button>
      `;

      listaServicios.forEach(srv => {
        const cant = conteoPorSrv[srv] || 0;
        if (cant > 0 || SERVICIO_SELECCIONADO_SIDEBAR === srv) {
          htmlChips += `
            <button type="button" class="srv-chip ${SERVICIO_SELECCIONADO_SIDEBAR === srv ? "active" : ""}" onclick="seleccionarServicioSidebar('${srv}')">
              <span>${srv}</span>
              <span class="srv-chip-count">${cant}</span>
            </button>
          `;
        }
      });
      contChips.innerHTML = htmlChips;
    } else {
      contChips.style.display = "none";
    }
  }

  let listaPacientes = todosLosPacientes.filter(p => {
    if (MODO_SIDEBAR === "SERVICIOS" && SERVICIO_SELECCIONADO_SIDEBAR !== "TODOS") {
      if (p.servicio.toUpperCase() !== SERVICIO_SELECCIONADO_SIDEBAR) return false;
    }
    if (!queryTxt) return true;
    return p.rut.includes(queryTxt) || p.nombreCompleto.includes(queryTxt) || p.servicio.includes(queryTxt);
  });

  const linkVolverMonitor = (MODO_SIDEBAR === "PACIENTES" && !queryTxt && VER_LISTA_PACIENTES_SIDEBAR)
    ? ` • <a onclick="toggleVerListaPacientesSidebar()" style="color:#0066ff; cursor:pointer; font-weight:800;">Volver al Monitor Vivo</a>`
    : "";

  document.getElementById("texto-coincidencias").innerHTML = `${listaPacientes.length} coincidencias${linkVolverMonitor}`;

  contenedor.innerHTML = listaPacientes.map(p => {
    const estaExpandido = PACIENTES_EXPANDIDOS.has(p.key) || listaPacientes.length === 1;
    const rutResaltado = queryTxt && p.rut.includes(queryTxt)
      ? p.rut.replace(queryTxt, `<span class="highlight-match">${queryTxt}</span>`)
      : p.rut;

    const htmlTratamientos = p.filas.map(f => {
      const m = calcularMetricasFila(f);
      let textoPildora;
      if (!m.esVigente) {
        textoPildora = `${f.estado.toUpperCase()} | Terminado (Finalizado)`;
      } else if (m.esCarga) {
        textoPildora = `${f.estado.toUpperCase()} | Vigente (Dosis de Carga — Último día)`;
      } else if (m.contadorActivo === 0) {
        textoPildora = `${f.estado.toUpperCase()} | Vigente (Lleva ${m.diasLleva} días / Último día)`;
      } else {
        textoPildora = `${f.estado.toUpperCase()} | Vigente (Lleva ${m.diasLleva} días / Quedan ${m.diasRestantesReales} días)`;
      }

      const clasePildora = m.esVigente ? "pill-vigente" : "pill-terminado";
      const htmlConducta = f.conducta ? `<div class="conducta-sub-pill">⇄ ${f.conducta}</div>` : "";

      return `
        <div class="trat-item-box">
          <div class="trat-header">
            <span class="material-icons-round" style="color:#007aff; font-size:16px;">medication</span>
            <span>${f.antimicrobiano}</span>
          </div>
          <div class="trat-sub">${f.dosis} C/ ${f.frecuencia}</div>
          <div class="semantic-pill ${clasePildora}">${textoPildora}</div>
          ${htmlConducta}
        </div>
      `;
    }).join("");

    const porAtb = {};
    p.filas.forEach(f => {
      const m = calcularMetricasFila(f);
      if (!porAtb[f.antimicrobiano]) {
        porAtb[f.antimicrobiano] = { totalDias: 0, vigente: false, fechaMasAntigua: f.fecha_inicio };
      }
      porAtb[f.antimicrobiano].totalDias += m.diasLleva;
      if (m.esVigente) porAtb[f.antimicrobiano].vigente = true;
      porAtb[f.antimicrobiano].fechaMasAntigua = f.fecha_inicio;
    });

    const htmlResumen = Object.keys(porAtb).map(atb => {
      const info = porAtb[atb];
      const estadoTxt = info.vigente
        ? `(Vigente — inicio: ${info.fechaMasAntigua.replace(/\//g, "-")})`
        : `(Terminado — inicio: ${info.fechaMasAntigua.replace(/\//g, "-")})`;
      return `<div class="resumen-line"><b>${atb}</b> ➡️ ${info.totalDias} días de tratamiento. ${estadoTxt}</div>`;
    }).join("");

    const botonEditarHTML = esQF
      ? `<button class="btn-card-action" onclick="abrirModalVisacion('${p.key}')">
           <span class="material-icons-round" style="font-size:14px;">edit</span>
           <span>Auditar / Editar</span>
         </button>`
      : "";

    const iniciales = p.nombreCompleto
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(n => n[0])
      .join("");

    return `
      <div class="p-card">
        <div class="p-card-header-elegant">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="p-card-avatar">${iniciales || "PT"}</div>
            <div>
              <div class="p-card-name" style="margin-bottom:2px;">${p.nombreCompleto}</div>
              <div style="font-size:11px; font-weight:700; color:#64748b;">RUT: ${rutResaltado}</div>
            </div>
          </div>
          <span style="font-size:10px; font-weight:800; background:#eff6ff; color:#0284c7; padding:3px 8px; border-radius:20px;">
            ${p.filas.length} ATB
          </span>
        </div>

        <div class="p-card-pills-row" style="display:flex; gap:6px; margin-bottom:12px;">
          <span class="meta-pill-badge">
            <span class="material-icons-round" style="font-size:13px; color:#0284c7;">domain</span> ${p.servicio}
          </span>
          <span class="meta-pill-badge">
            <span class="material-icons-round" style="font-size:13px; color:#0284c7;">bed</span> Cama: ${p.cama}
          </span>
        </div>

        <div class="p-card-actions" style="grid-template-columns: ${esQF ? "1fr 1fr" : "1fr"};">
          <button class="btn-card-action" onclick="toggleDetalleTarjeta('${p.key}')">
            <span class="material-icons-round" style="font-size:15px;">${estaExpandido ? "expand_less" : "expand_more"}</span>
            <span>${estaExpandido ? "Ocultar Terapias" : "Ver Terapias"}</span>
          </button>
          ${botonEditarHTML}
        </div>

        <div class="p-card-details" style="display: ${estaExpandido ? "block" : "none"}; animation: fadeInLive 0.25s ease;">
          <div class="details-section-title">ESQUEMA ANTIMICROBIANO</div>
          ${htmlTratamientos}

          <div class="resumen-historico-box">
            <div class="resumen-title">RESUMEN CLÍNICO HISTÓRICO</div>
            ${htmlResumen}
          </div>
        </div>
      </div>
    `;
  }).join("");
};

window.irAServicioDesdeMonitor = function(srv) {
  MODO_SIDEBAR = "SERVICIOS";
  SERVICIO_SELECCIONADO_SIDEBAR = srv;
  document.getElementById("tab-btn-pacientes").classList.remove("active");
  document.getElementById("tab-btn-servicios").classList.add("active");
  renderizarBarraLateral();
};

window.toggleDetalleTarjeta = function(key) {
  if (PACIENTES_EXPANDIDOS.has(key)) PACIENTES_EXPANDIDOS.delete(key);
  else PACIENTES_EXPANDIDOS.add(key);
  renderizarBarraLateral();
};

window.seleccionarServicioSidebar = function(srv) {
  SERVICIO_SELECCIONADO_SIDEBAR = srv;
  renderizarBarraLateral();
};

window.cambiarModoBusqueda = function(modo) {
  MODO_SIDEBAR = modo;
  if (modo === "PACIENTES") {
    SERVICIO_SELECCIONADO_SIDEBAR = "TODOS";
    VER_LISTA_PACIENTES_SIDEBAR = false;
  }
  document.getElementById("tab-btn-pacientes").classList.toggle("active", modo === "PACIENTES");
  document.getElementById("tab-btn-servicios").classList.toggle("active", modo === "SERVICIOS");
  renderizarBarraLateral();
};

window.limpiarBuscadorLateral = function() {
  document.getElementById("input-buscador-lateral").value = "";
  VER_LISTA_PACIENTES_SIDEBAR = false;
  renderizarBarraLateral();
};

// CENTRO DE NOTIFICACIONES CLÍNICAS
window.togglePanelNotificaciones = function() {
  const panel = document.getElementById("panel-notificaciones");
  const visible = panel.style.display === "flex";
  panel.style.display = visible ? "none" : "flex";
  if (!visible) {
    document.getElementById("notif-badge").style.display = "none";
  }
};

window.cargarNotificacionesEnVivo = async function() {
  const lista = await obtenerNotificacionesDescifradas();
  const badge = document.getElementById("notif-badge");
  const cont = document.getElementById("lista-notificaciones-dom");

  if (lista.length > 0) {
    badge.innerText = lista.length;
    badge.style.display = "inline-block";
    cont.innerHTML = lista.map(n => `
      <div class="notif-item">
        <div>🧑‍⚕️ ${n.mensaje}</div>
        <span class="notif-time">🕒 ${n.fecha_hora}</span>
      </div>
    `).join("");
  } else {
    badge.style.display = "none";
    cont.innerHTML = `<div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 12px;">Sin notificaciones registradas aún.</div>`;
  }
};

window.toggleDetalleTarjeta = function(key) {
  if (PACIENTES_EXPANDIDOS.has(key)) PACIENTES_EXPANDIDOS.delete(key);
  else PACIENTES_EXPANDIDOS.add(key);
  renderizarBarraLateral();
};

window.seleccionarServicioSidebar = function(srv) {
  SERVICIO_SELECCIONADO_SIDEBAR = srv;
  renderizarBarraLateral();
};

window.cambiarModoBusqueda = function(modo) {
  MODO_SIDEBAR = modo;
  if (modo === "PACIENTES") SERVICIO_SELECCIONADO_SIDEBAR = "TODOS";
  document.getElementById("tab-btn-pacientes").classList.toggle("active", modo === "PACIENTES");
  document.getElementById("tab-btn-servicios").classList.toggle("active", modo === "SERVICIOS");
  renderizarBarraLateral();
};

window.limpiarBuscadorLateral = function() {
  document.getElementById("input-buscador-lateral").value = "";
  renderizarBarraLateral();
};

// =========================================================================
// 8. ESTACIÓN COMPLETA DE AUDITORÍA CLÍNICA (QF) - IDÉNTICA A PROA 3.3
// =========================================================================

function hoyFormateadoCL() {
  const d = new Date();
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

window.abrirModalVisacionVacio = function() {
  PACIENTE_AUDITORIA_ACTUAL = null;
  document.getElementById("aud-rut").value = "";
  document.getElementById("aud-nombres").value = "";
  document.getElementById("aud-apellidos").value = "";
  document.getElementById("aud-servicio").value = "";
  document.getElementById("aud-cama").value = "";
  document.getElementById("contenedor-historial-modal").innerHTML = "";
  document.getElementById("contenedor-tarjetas-activas-qf").innerHTML =
    `<div style="text-align:center; color:#94a3b8; padding:20px; font-size:12px;">Busque un paciente arriba por RUT o Nombre para auditar sus tratamientos.</div>`;
  document.getElementById("modal-visacion-qf").style.display = "flex";
};

window.abrirModalVisacion = function(hashPaciente) {
  const filasDelPaciente = MEMORIA_FILAS.filter(f => f.hashPaciente === hashPaciente);
  if (!filasDelPaciente.length) return;

  const p0 = filasDelPaciente[0];
  PACIENTE_AUDITORIA_ACTUAL = {
    hashPaciente: p0.hashPaciente,
    rut: p0.rut,
    nombre: p0.nombre,
    apellido: p0.apellido,
    servicio: p0.servicio,
    cama: p0.cama,
    filas: filasDelPaciente
  };

  document.getElementById("aud-rut").value = p0.rut;
  document.getElementById("aud-nombres").value = p0.nombre;
  document.getElementById("aud-apellidos").value = p0.apellido;
  document.getElementById("aud-servicio").value = p0.servicio;
  document.getElementById("aud-cama").value = p0.cama;

  // Separar tratamientos activos vs finalizados
  const activos = [];
  const finalizados = [];

  filasDelPaciente.forEach(f => {
    const m = calcularMetricasFila(f);
    if (m.esVigente || f.estado.toUpperCase() === "SOLICITUD") activos.push(f);
    else finalizados.push(f);
  });

  // Renderizar Acordeón de Historial Clínico (Finalizados)
  const contHist = document.getElementById("contenedor-historial-modal");
  document.getElementById("titulo-acordeon-historial").innerText =
    `Historial Clínico (${finalizados.length} Tratamientos Finalizados)`;

  if (!finalizados.length) {
    contHist.innerHTML = `<div style="font-size:12px; color:#94a3b8;">No hay tratamientos finalizados previos.</div>`;
  } else {
    contHist.innerHTML = finalizados.map(f => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:12px;">
        <div>
          <b>${f.antimicrobiano}</b> (${f.dosis} c/${f.frecuencia}) — Inicio: ${f.fecha_inicio}
          <span style="margin-left:6px; color:#dc2626; font-weight:700;">[${f.estado.toUpperCase()} / ${f.conducta || "FINALIZADO"}]</span>
        </div>
        <button type="button" class="btn-card-action" style="padding:4px 10px;" onclick="reactivarTratamientoAlPanelActivo('${f.idTratamiento}')">
          Reactivar / Editar
        </button>
      </div>
    `).join("");
  }

  // Renderizar Tarjetas de Tratamientos Activos (Si todos estaban finalizados, mostramos el más reciente para editar)
  const contActivos = document.getElementById("contenedor-tarjetas-activas-qf");
  contActivos.innerHTML = "";
  const listaParaEditar = activos.length > 0 ? activos : [filasDelPaciente[0]];
  listaParaEditar.forEach((f, idx) => agregarTarjetaTratamientoQF(f, idx + 1));

  document.getElementById("modal-visacion-qf").style.display = "flex";
};

window.reactivarTratamientoAlPanelActivo = function(idTratamiento) {
  if (!PACIENTE_AUDITORIA_ACTUAL) return;
  const fila = PACIENTE_AUDITORIA_ACTUAL.filas.find(f => f.idTratamiento === idTratamiento);
  if (fila) agregarTarjetaTratamientoQF(fila, "HIST");
};

window.toggleAcordeonHistorialModal = function() {
  const cont = document.getElementById("contenedor-historial-modal");
  const icon = document.getElementById("icono-acordeon-hist");
  const abierto = cont.style.display === "block";
  cont.style.display = abierto ? "none" : "block";
  icon.innerText = abierto ? "expand_more" : "expand_less";
};

// Buscador de pacientes dentro del modal de Auditoría
window.buscarPacienteEnModalAuditoria = function(input) {
  const val = input.value.trim().toUpperCase();
  const drop = document.getElementById("aud-dropdown-sug");
  if (val.length < 2) { drop.style.display = "none"; return; }

  const mapaUnicos = {};
  MEMORIA_FILAS.forEach(f => { if (!mapaUnicos[f.hashPaciente]) mapaUnicos[f.hashPaciente] = f; });

  const coincidencias = Object.values(mapaUnicos).filter(p =>
    p.rut.includes(val) || p.nombre.includes(val) || p.apellido.includes(val)
  );

  if (!coincidencias.length) { drop.style.display = "none"; return; }

  drop.innerHTML = coincidencias.slice(0, 6).map(p => `
    <div class="sug-item" onclick="seleccionarPacienteEnModalAuditoria('${p.hashPaciente}')">
      <b>${p.rut}</b> — ${p.nombre} ${p.apellido} <span style="color:#64748b;">(${p.servicio})</span>
    </div>
  `).join("");
  drop.style.display = "block";
};

window.seleccionarPacienteEnModalAuditoria = function(hashPaciente) {
  document.getElementById("aud-dropdown-sug").style.display = "none";
  abrirModalVisacion(hashPaciente);
};

// Construye la tarjeta de 5 filas idéntica a PROA 3.3 Auditoría Clínica
function agregarTarjetaTratamientoQF(f = {}, indice = 1) {
  const contenedor = document.getElementById("contenedor-tarjetas-activas-qf");
  const div = document.createElement("div");
  div.className = "qf-trat-card";
  div.dataset.idTratamiento = f.idTratamiento || "";

  const estadoInicial = (f.estado || "SOLICITUD").toUpperCase();
  const claseColorEstado = estadoInicial === "APROBADO"
    ? "qf-est-aprobado"
    : estadoInicial === "RECHAZADO" ? "qf-est-rechazado" : "qf-est-solicitud";

  const fInicioTexto = f.fecha_inicio || hoyFormateadoCL();
  const fVisadoTexto = f.fecha_visado || hoyFormateadoCL();
  const etiquetaAzul = f.idTratamiento
    ? `EDICIÓN REGISTRO #${indice} | INICIO TTO: ${fInicioTexto}`
    : `NUEVO TRATAMIENTO (HEREDADO) | INICIO TTO: ${fInicioTexto}`;

  div.innerHTML = `
    <div class="qf-row-badge">${etiquetaAzul}</div>

    <!-- FILA 1: ESTADO, ANTIBIÓTICO, CARGA, DOSIS, FRECUENCIA Y BASURERO -->
    <div class="qf-grid-row1">
      <div class="field-group">
        <label>ESTADO</label>
        <select class="qf-estado-select ${claseColorEstado} qf-in-estado nav-field" onchange="actualizarColorSelectEstadoQF(this)">
          <option value="APROBADO" ${estadoInicial === "APROBADO" ? "selected" : ""}>APROBADO</option>
          <option value="SOLICITUD" ${estadoInicial === "SOLICITUD" ? "selected" : ""}>SOLICITUD</option>
          <option value="RECHAZADO" ${estadoInicial === "RECHAZADO" ? "selected" : ""}>RECHAZADO</option>
        </select>
      </div>
      <div class="field-group">
        <label>ANTIBIÓTICO</label>
        <input type="text" data-ac="antimicrobianos" class="proa-input qf-in-atb nav-field" value="${f.antimicrobiano || ""}" placeholder="Buscar..." autocomplete="off">
      </div>
      <div class="field-group">
        <label>CARGA</label>
        <select class="proa-select qf-in-carga nav-field">
          <option value="NO" ${(f.carga || "NO") === "NO" ? "selected" : ""}>NO</option>
          <option value="SI" ${f.carga === "SI" ? "selected" : ""}>SI</option>
        </select>
      </div>
      <div class="field-group">
        <label>DOSIS</label>
        <input type="text" data-ac="dosis" class="proa-input qf-in-dosis nav-field" value="${f.dosis || ""}" placeholder="Buscar..." autocomplete="off">
      </div>
      <div class="field-group">
        <label>FRECUENCIA</label>
        <input type="text" data-ac="frecuencias" class="proa-input qf-in-frec nav-field" value="${f.frecuencia || ""}" placeholder="Buscar..." autocomplete="off">
      </div>
      <button type="button" class="btn-trash" title="Eliminar prescripción" onclick="eliminarTarjetaTratamientoQF(this, '${f.idTratamiento || ""}')">
        <span class="material-icons-round" style="font-size: 18px;">delete</span>
      </button>
    </div>

    <!-- FILA 2: ZONA VERDE (W, X, Y, Z) -->
    <div class="qf-grid-4cols">
      <div class="field-group">
        <label>DIAGNÓSTICO (W)</label>
        <input type="text" data-ac="diagnosticos" class="proa-input qf-in-diag nav-field" value="${f.diagnostico || ""}" placeholder="Buscar..." autocomplete="off">
      </div>
      <div class="field-group">
        <label>TIPO DE TRATAMIENTO (X)</label>
        <input type="text" data-ac="tipoTto" class="proa-input qf-in-tipotto nav-field" value="${f.tipo_tratamiento || ""}" placeholder="INICIO / CONTINUACIÓN" autocomplete="off">
      </div>
      <div class="field-group">
        <label>TIPO DE TERAPIA (Y)</label>
        <input type="text" data-ac="tipoTerapia" class="proa-input qf-in-tipoterapia nav-field" value="${f.tipo_terapia || ""}" placeholder="EMPIRICA / ESPECIFICA" autocomplete="off">
      </div>
      <div class="field-group">
        <label>LUGAR DE INFECCIÓN (Z)</label>
        <input type="text" data-ac="lugarInf" class="proa-input qf-in-lugar nav-field" value="${f.lugar_infeccion || ""}" placeholder="INTRA / EXTRAHOSP." autocomplete="off">
      </div>
    </div>

    <!-- FILA 3: ZONA AMARILLA PARTE 1 (AA, AB, AC, AE) -->
    <div class="qf-grid-4cols">
      <div class="field-group">
        <label>TRATAMIENTO / CONDUCTA (AA)</label>
        <input type="text" data-ac="estadoClinico" class="proa-input qf-in-estadoclinico nav-field" value="${f.conducta || ""}" placeholder="AUTORIZADO / SUSPENDIDO..." autocomplete="off">
      </div>
      <div class="field-group">
        <label>DIAS DE APROBACIÓN (AB)</label>
        <input type="number" class="proa-input qf-in-diasaprob nav-field" value="${f.dias_autorizacion !== null && f.dias_autorizacion !== undefined ? f.dias_autorizacion : ""}" placeholder="N° días">
      </div>
      <div class="field-group">
        <label>USO ADECUADO DE ATB (AC)</label>
        <input type="text" data-ac="usoAdecuado" class="proa-input qf-in-usoadecuado nav-field" value="${f.uso_adecuado || ""}" placeholder="Buscar..." autocomplete="off">
      </div>
      <div class="field-group">
        <label>VISADOR (AE)</label>
        <input type="text" data-ac="visadores" class="proa-input qf-in-visador nav-field" value="${f.visador || ""}" placeholder="QF / Infectólogo..." autocomplete="off">
      </div>
    </div>

    <!-- FILA 4: FECHA INICIO, FECHA VISADO (AF), PACIENTE NO ENCONTRADO (AG) Y DIGITADOR -->
    <div class="qf-grid-fechas">
      <div class="field-group">
        <label>FECHA INICIO (F)</label>
        <input type="text" class="proa-input qf-in-fechaini" value="${fInicioTexto}" tabindex="-1">
      </div>
      <div class="field-group">
        <label>FECHA VISADO (AF)</label>
        <input type="text" class="proa-input qf-in-fechavisado" value="${fVisadoTexto}" tabindex="-1">
      </div>
      <div class="field-group">
        <label>PACIENTE NO ENCONTRADO (AG)</label>
        <input type="text" data-ac="pacNoEncontrado" class="proa-input qf-in-pacnoenc nav-field" value="${f.paciente_no_encontrado || ""}" placeholder="Opcional..." autocomplete="off">
      </div>
      <div class="field-group">
        <label>DIGITADOR / RESP. (P)</label>
        <input type="text" data-ac="digitadores" class="proa-input proa-input-readonly qf-in-digitador" value="${f.digitador || "FRANCISCO BARRA"}" tabindex="-1">
      </div>
    </div>

    <!-- FILA 5: OBSERVACIONES (AD) -->
    <div class="field-group">
      <label>OBSERVACIONES (AD)</label>
      <input type="text" class="proa-input qf-in-obs nav-field" value="${f.observaciones || ""}" placeholder="ESCRIBA AQUÍ SUS OBSERVACIONES CLÍNICAS...">
    </div>
  `;

  contenedor.appendChild(div);
}

window.actualizarColorSelectEstadoQF = function(selectEl) {
  selectEl.classList.remove("qf-est-aprobado", "qf-est-solicitud", "qf-est-rechazado");
  const val = selectEl.value.toUpperCase();
  if (val === "APROBADO") selectEl.classList.add("qf-est-aprobado");
  else if (val === "RECHAZADO") selectEl.classList.add("qf-est-rechazado");
  else selectEl.classList.add("qf-est-solicitud");
};

window.iniciarNuevoTratamientoHeredado = function() {
  const tarjetas = document.querySelectorAll(".qf-trat-card");
  let datosHeredados = {
    estado: "APROBADO",
    carga: "NO",
    fecha_inicio: hoyFormateadoCL(),
    fecha_visado: hoyFormateadoCL(),
    digitador: document.getElementById("header-user-name").innerText || "QF"
  };

  if (tarjetas.length > 0) {
    const ultima = tarjetas[tarjetas.length - 1];
    datosHeredados.diagnostico = ultima.querySelector(".qf-in-diag").value;
    datosHeredados.tipo_tratamiento = "CONTINUACIÓN";
    datosHeredados.tipo_terapia = ultima.querySelector(".qf-in-tipoterapia").value;
    datosHeredados.lugar_infeccion = ultima.querySelector(".qf-in-lugar").value;
    datosHeredados.visador = ultima.querySelector(".qf-in-visador").value;
    datosHeredados.uso_adecuado = "CAMBIO DE ATM";
  }

  agregarTarjetaTratamientoQF(datosHeredados, tarjetas.length + 1);
};

window.eliminarTarjetaTratamientoQF = async function(btn, idTratamiento) {
  if (idTratamiento && PACIENTE_AUDITORIA_ACTUAL) {
    const confirmar = confirm("¿Eliminar definitivamente esta prescripción de la base de datos?");
    if (!confirmar) return;
    await eliminarTratamientoFirestore(PACIENTE_AUDITORIA_ACTUAL.hashPaciente, idTratamiento);
    btn.closest(".qf-trat-card").remove();
    await cargarMatrizEnVivo();
  } else {
    btn.closest(".qf-trat-card").remove();
  }
};

window.cerrarModalVisacion = function() {
  document.getElementById("modal-visacion-qf").style.display = "none";
};

window.guardarCambiosVisacionQF = async function() {
  if (!PACIENTE_AUDITORIA_ACTUAL) {
    alert("Seleccione primero un paciente válido.");
    return;
  }

  const btn = document.getElementById("btn-submit-visacion");
  btn.innerHTML = `<span>⏳ Cifrando Auditoría y Sincronizando con Firestore...</span>`;
  btn.disabled = true;

  const tarjetasDOM = document.querySelectorAll(".qf-trat-card");
  const tratamientosPayload = [];

  tarjetasDOM.forEach(card => {
    const atb = card.querySelector(".qf-in-atb").value.trim();
    if (!atb) return;

    tratamientosPayload.push({
      idTratamiento: card.dataset.idTratamiento || null,
      estado: card.querySelector(".qf-in-estado").value,
      antimicrobiano: atb,
      carga: card.querySelector(".qf-in-carga").value,
      dosis: card.querySelector(".qf-in-dosis").value,
      frecuencia: card.querySelector(".qf-in-frec").value,
      diagnostico: card.querySelector(".qf-in-diag").value,
      tipoTratamiento: card.querySelector(".qf-in-tipotto").value,
      tipoTerapia: card.querySelector(".qf-in-tipoterapia").value,
      lugarInfeccion: card.querySelector(".qf-in-lugar").value,
      estadoClinico: card.querySelector(".qf-in-estadoclinico").value,
      diasAprob: card.querySelector(".qf-in-diasaprob").value,
      usoAdecuado: card.querySelector(".qf-in-usoadecuado").value,
      visador: card.querySelector(".qf-in-visador").value,
      fechaInicio: card.querySelector(".qf-in-fechaini").value,
      fechaVisado: card.querySelector(".qf-in-fechavisado").value,
      pacienteNoEncontrado: card.querySelector(".qf-in-pacnoenc").value,
      digitador: card.querySelector(".qf-in-digitador").value,
      observaciones: card.querySelector(".qf-in-obs").value
    });
  });

  await guardarAuditoriaCompletaQF({
    hashPaciente: PACIENTE_AUDITORIA_ACTUAL.hashPaciente,
    rut: document.getElementById("aud-rut").value,
    nombre: document.getElementById("aud-nombres").value,
    apellido: document.getElementById("aud-apellidos").value,
    servicio: document.getElementById("aud-servicio").value,
    cama: document.getElementById("aud-cama").value,
    tratamientos: tratamientosPayload
  });

  const nomPac = `${document.getElementById("aud-nombres").value} ${document.getElementById("aud-apellidos").value}`.trim();
  for (const t of tratamientosPayload) {
    const diasTxt = t.diasAprob ? ` por ${t.diasAprob} días` : "";
    await registrarNotificacionPROA(`QF ${t.visador || PERFIL_ACTUAL.nombre} actualizó el tratamiento del paciente ${nomPac} (${t.antimicrobiano}) a estado ${t.estado}${diasTxt}.`, "AUDITORIA");
  }
  await cargarNotificacionesEnVivo();

  btn.innerHTML = `<span class="material-icons-round" style="font-size: 19px;">save</span> <span>GUARDAR VISACIÓN Y SINCRONIZAR</span>`;
  btn.disabled = false;

  cerrarModalVisacion();
  await cargarMatrizEnVivo();
};

window.actualizarColorSelectEstadoQF = function(selectEl) {
  selectEl.classList.remove("qf-est-aprobado", "qf-est-solicitud", "qf-est-rechazado");
  const val = selectEl.value.toUpperCase();
  if (val === "APROBADO") selectEl.classList.add("qf-est-aprobado");
  else if (val === "RECHAZADO") selectEl.classList.add("qf-est-rechazado");
  else selectEl.classList.add("qf-est-solicitud");
};

// Botón "+ Iniciar Nuevo Tratamiento (Heredar Datos)"
window.iniciarNuevoTratamientoHeredado = function() {
  const tarjetas = document.querySelectorAll(".qf-trat-card");
  let datosHeredados = {
    estado: "APROBADO",
    carga: "NO",
    fecha_inicio: hoyFormateadoCL(),
    fecha_visado: hoyFormateadoCL(),
    digitador: document.getElementById("header-user-name").innerText || "QF"
  };

  if (tarjetas.length > 0) {
    const ultima = tarjetas[tarjetas.length - 1];
    datosHeredados.diagnostico = ultima.querySelector(".qf-in-diag").value;
    datosHeredados.tipo_tratamiento = "CONTINUACIÓN";
    datosHeredados.tipo_terapia = ultima.querySelector(".qf-in-tipoterapia").value;
    datosHeredados.lugar_infeccion = ultima.querySelector(".qf-in-lugar").value;
    datosHeredados.visador = ultima.querySelector(".qf-in-visador").value;
    datosHeredados.uso_adecuado = "CAMBIO DE ATM";
  }

  agregarTarjetaTratamientoQF(datosHeredados, tarjetas.length + 1);
};

// Eliminar tarjeta o registro de Firestore desde el botón papelera
window.eliminarTarjetaTratamientoQF = async function(btn, idTratamiento) {
  if (idTratamiento && PACIENTE_AUDITORIA_ACTUAL) {
    const confirmar = confirm("¿Eliminar definitivamente esta prescripción de la base de datos?");
    if (!confirmar) return;
    await eliminarTratamientoFirestore(PACIENTE_AUDITORIA_ACTUAL.hashPaciente, idTratamiento);
    btn.closest(".qf-trat-card").remove();
    await cargarMatrizEnVivo();
  } else {
    btn.closest(".qf-trat-card").remove();
  }
};

window.cerrarModalVisacion = function() {
  document.getElementById("modal-visacion-qf").style.display = "none";
};

// Guardar Visación y Sincronizar (Botón Azul Principal)
window.guardarCambiosVisacionQF = async function() {
  if (!PACIENTE_AUDITORIA_ACTUAL) {
    alert("Seleccione primero un paciente válido.");
    return;
  }

  const btn = document.getElementById("btn-submit-visacion");
  btn.innerHTML = `<span>⏳ Cifrando Auditoría y Sincronizando con Firestore...</span>`;
  btn.disabled = true;

  const tarjetasDOM = document.querySelectorAll(".qf-trat-card");
  const tratamientosPayload = [];

  tarjetasDOM.forEach(card => {
    const atb = card.querySelector(".qf-in-atb").value.trim();
    if (!atb) return;

    tratamientosPayload.push({
      idTratamiento: card.dataset.idTratamiento || null,
      estado: card.querySelector(".qf-in-estado").value,
      antimicrobiano: atb,
      carga: card.querySelector(".qf-in-carga").value,
      dosis: card.querySelector(".qf-in-dosis").value,
      frecuencia: card.querySelector(".qf-in-frec").value,
      diagnostico: card.querySelector(".qf-in-diag").value,
      tipoTratamiento: card.querySelector(".qf-in-tipotto").value,
      tipoTerapia: card.querySelector(".qf-in-tipoterapia").value,
      lugarInfeccion: card.querySelector(".qf-in-lugar").value,
      estadoClinico: card.querySelector(".qf-in-estadoclinico").value,
      diasAprob: card.querySelector(".qf-in-diasaprob").value,
      usoAdecuado: card.querySelector(".qf-in-usoadecuado").value,
      visador: card.querySelector(".qf-in-visador").value,
      fechaInicio: card.querySelector(".qf-in-fechaini").value,
      fechaVisado: card.querySelector(".qf-in-fechavisado").value,
      digitador: card.querySelector(".qf-in-digitador").value,
      observaciones: card.querySelector(".qf-in-obs").value
    });
  });

  await guardarAuditoriaCompletaQF({
    hashPaciente: PACIENTE_AUDITORIA_ACTUAL.hashPaciente,
    rut: document.getElementById("aud-rut").value,
    nombre: document.getElementById("aud-nombres").value,
    apellido: document.getElementById("aud-apellidos").value,
    servicio: document.getElementById("aud-servicio").value,
    cama: document.getElementById("aud-cama").value,
    tratamientos: tratamientosPayload
  });

  btn.innerHTML = `<span class="material-icons-round" style="font-size: 19px;">save</span> <span>GUARDAR VISACIÓN Y SINCRONIZAR</span>`;
  btn.disabled = false;

  cerrarModalVisacion();
  await cargarMatrizEnVivo();
};

// =========================================================================
// MOTOR DE TEMA VISUAL: MODO DÍA (LIGHT), NOCHE (DARK) Y AUTOMÁTICO (AUTO)
// =========================================================================
let MODO_TEMA_ACTUAL = localStorage.getItem("proa_v4_theme_mode") || "AUTO";

window.cambiarTemaPROA = function(modo) {
  MODO_TEMA_ACTUAL = modo;
  localStorage.setItem("proa_v4_theme_mode", modo);

  document.getElementById("theme-btn-light")?.classList.toggle("active", modo === "LIGHT");
  document.getElementById("theme-btn-dark")?.classList.toggle("active", modo === "DARK");
  document.getElementById("theme-btn-auto")?.classList.toggle("active", modo === "AUTO");

  let usarOscuro = false;
  if (modo === "DARK") {
    usarOscuro = true;
  } else if (modo === "AUTO") {
    const prefiereSistemaOscuro = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const horaActual = new Date().getHours();
    const esHorarioNocturno = (horaActual >= 20 || horaActual < 7);
    usarOscuro = prefiereSistemaOscuro || esHorarioNocturno;
  }

  document.body.classList.toggle("dark-mode", usarOscuro);
};

// Inicializar tema al cargar y escuchar cambios del sistema operativo
document.addEventListener("DOMContentLoaded", () => {
  cambiarTemaPROA(MODO_TEMA_ACTUAL);
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (MODO_TEMA_ACTUAL === "AUTO") cambiarTemaPROA("AUTO");
    });
  }
});