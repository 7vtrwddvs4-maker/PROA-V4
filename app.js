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
  eliminarNotificacionPROA,
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
let PACIENTE_AUDITORIA_ACTUAL = null;
let SERVICIO_SELECCIONADO_SIDEBAR = "TODOS";

document.addEventListener("DOMContentLoaded", () => {
  const hoyISO = new Date().toISOString().split("T")[0];
  const inFecha = document.getElementById("in-fecha");
  if (inFecha) inFecha.value = hoyISO;
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

    if (MODO_CREAR_CUENTA && nombreInput) {
      await guardarPerfilUsuario(res.user.uid, { nombre: nombreInput, rol: rolInput, email });
    }

    const MAPA_CORREOS_NOMBRES = {
      "barra.francisco30@gmail.com": "FRANCISCO BARRA",
      "barra.francisco@icloud.com": "FRANCISCO BARRA",
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

  const inDig = document.getElementById("in-digitador");
  if (inDig && PERFIL_ACTUAL.nombre) inDig.value = PERFIL_ACTUAL.nombre;

  const btnAudTop = document.getElementById("btn-top-auditoria-qf");
  if (btnAudTop) btnAudTop.style.display = esQF ? "inline-flex" : "none";

  document.querySelectorAll(".med-estado").forEach(sel => {
    if (!esQF) {
      sel.value = "SOLICITUD";
      sel.disabled = true;
      sel.title = "Los perfiles TENS solo pueden ingresar tratamientos en estado SOLICITUD";
      alCambiarEstadoEnIngreso(sel);
    } else {
      sel.disabled = false;
      sel.title = "";
    }
  });
}

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

// MOTOR UNIVERSAL DE TECLADO: FLECHAS + ENTER Y TAB
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

    const anchoMenu = Math.max(rect.width, 250);
    const leftSeguro = Math.min(rect.left, window.innerWidth - anchoMenu - 12);
    popup.style.left = `${Math.max(8, leftSeguro)}px`;
    popup.style.width = `${anchoMenu}px`;

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
      if (el.dataset.hash && el.dataset.idtrat && el.dataset.campo) {
        window.guardarCeldaMatrizQF(el.dataset.hash, el.dataset.idtrat, el.dataset.campo, el.value);
      } else {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    popup.style.display = "none";
    avanzarAlSiguienteCampo(el, 1);
  }

  function obtenerContenedorNavegacion(el) {
    return el.closest("#modal-visacion-qf") || el.closest("#proa-tbody") || document.getElementById("cuerpo-formulario-ingreso");
  }

  function avanzarAlSiguienteCampo(elementoActual, direccion = 1) {
    const contenedorRaiz = obtenerContenedorNavegacion(elementoActual);
    if (!contenedorRaiz) return;

    const camposNavegables = Array.from(contenedorRaiz.querySelectorAll(".nav-field:not([disabled])"))
      .filter(el => el.offsetParent !== null);

    const idxActual = camposNavegables.indexOf(elementoActual);
    const idxDestino = idxActual + direccion;

    if (idxActual !== -1 && idxDestino >= 0 && idxDestino < camposNavegables.length) {
      const siguiente = camposNavegables[idxDestino];
      siguiente.focus();
      if (siguiente.select && siguiente.tagName === "INPUT") siguiente.select();
    }
  }

  function moverVerticalEnMatriz(elementoActual, deltaFila) {
    const trActual = elementoActual.closest("tr");
    const tdActual = elementoActual.closest("td");
    if (!trActual || !tdActual) return false;

    const tbody = trActual.parentElement;
    const filasTR = Array.from(tbody.querySelectorAll("tr"));
    const idxFila = filasTR.indexOf(trActual);
    const colIndex = Array.from(trActual.children).indexOf(tdActual);

    const trDestino = filasTR[idxFila + deltaFila];
    if (trDestino && trDestino.children[colIndex]) {
      const inputDestino = trDestino.children[colIndex].querySelector(".nav-field:not([disabled])");
      if (inputDestino) {
        inputDestino.focus();
        if (inputDestino.select && inputDestino.tagName === "INPUT") inputDestino.select();
        return true;
      }
    }
    return false;
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
    const estaEnMatriz = Boolean(target.closest("#proa-tbody"));

    if (e.key === "ArrowDown") {
      if (menuAbierto) {
        e.preventDefault();
        indiceSeleccionado = (indiceSeleccionado + 1) % itemsActuales.length;
        actualizarVistaItems();
      } else if (estaEnMatriz) {
        e.preventDefault();
        moverVerticalEnMatriz(target, 1);
      } else if (target.tagName !== "SELECT") {
        e.preventDefault();
        avanzarAlSiguienteCampo(target, 1);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      if (menuAbierto) {
        e.preventDefault();
        indiceSeleccionado = (indiceSeleccionado - 1 + itemsActuales.length) % itemsActuales.length;
        actualizarVistaItems();
      } else if (estaEnMatriz) {
        e.preventDefault();
        moverVerticalEnMatriz(target, -1);
      } else if (target.tagName !== "SELECT") {
        e.preventDefault();
        avanzarAlSiguienteCampo(target, -1);
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      const alInicio = target.tagName === "SELECT" || target.tagName === "BUTTON" ||
                       target.type === "number" ||
                       (target.selectionStart === 0 && target.selectionEnd === target.value.length) ||
                       (target.selectionStart === 0 && target.selectionEnd === 0);
      if (alInicio) {
        e.preventDefault();
        popup.style.display = "none";
        avanzarAlSiguienteCampo(target, -1);
      }
      return;
    }

    if (e.key === "ArrowRight") {
      const alFinal = target.tagName === "SELECT" || target.tagName === "BUTTON" ||
                      target.type === "number" ||
                      (target.selectionStart === 0 && target.selectionEnd === target.value.length && target.value.length > 0) ||
                      (target.selectionStart === target.value.length && target.selectionEnd === target.value.length);
      if (alFinal) {
        e.preventDefault();
        popup.style.display = "none";
        avanzarAlSiguienteCampo(target, 1);
      }
      return;
    }

    if (e.key === "Enter" || e.key === "Tab") {
      const dir = (e.key === "Tab" && e.shiftKey) ? -1 : 1;

      if (target.tagName === "BUTTON") {
        if (e.key === "Enter") {
          e.preventDefault();
          target.click();
        } else {
          e.preventDefault();
          avanzarAlSiguienteCampo(target, dir);
        }
        return;
      }

      if (menuAbierto && dir === 1) {
        e.preventDefault();
        seleccionarYAvanzar(indiceSeleccionado);
      } else {
        e.preventDefault();
        popup.style.display = "none";
        if (e.key === "Enter" && target.closest(".tr-nuevo-matriz") && target.classList.contains("new-mat-trigger-save")) {
          guardarNuevoPacienteDesdeMatriz();
          return;
        }
        avanzarAlSiguienteCampo(target, dir);
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

// 2. GESTIÓN DE FILAS MÚLTIPLES EN INGRESO
window.agregarFilaMedicamento = function(enfocarNuevo = false) {
  const contenedor = document.getElementById("contenedor-filas-medicamentos");
  const wrapper = document.createElement("div");
  wrapper.className = "med-item-wrapper";
  const hoyCL = hoyFormateadoCL();

  wrapper.innerHTML = `
    <div class="med-row">
      <div class="field-group">
        <label>ESTADO</label>
        <select class="estado-select-pill med-estado nav-field" onchange="alCambiarEstadoEnIngreso(this)">
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
    </div>

    <div class="qf-ingreso-extra-panel">
      <div class="qf-ingreso-extra-badge">✨ Campos Opcionales de Visación QF (Puedes dejarlos en blanco si lo deseas)</div>
      
      <div class="qf-grid-4cols">
        <div class="field-group">
          <label>DIAGNÓSTICO (OPCIONAL)</label>
          <input type="text" data-ac="diagnosticos" class="proa-input med-qf-diag nav-field" placeholder="Buscar..." autocomplete="off">
        </div>
        <div class="field-group">
          <label>TIPO DE TRATAMIENTO</label>
          <input type="text" data-ac="tipoTto" class="proa-input med-qf-tipotto nav-field" placeholder="INICIO / CONTINUACIÓN" autocomplete="off">
        </div>
        <div class="field-group">
          <label>TIPO DE TERAPIA</label>
          <input type="text" data-ac="tipoTerapia" class="proa-input med-qf-tipoterapia nav-field" placeholder="EMPIRICA / ESPECIFICA" autocomplete="off">
        </div>
        <div class="field-group">
          <label>LUGAR DE INFECCIÓN</label>
          <input type="text" data-ac="lugarInf" class="proa-input med-qf-lugar nav-field" placeholder="INTRA / EXTRAHOSP." autocomplete="off">
        </div>
      </div>

      <div class="qf-grid-4cols">
        <div class="field-group">
          <label>TRATAMIENTO / CONDUCTA</label>
          <input type="text" data-ac="estadoClinico" class="proa-input med-qf-conducta nav-field" placeholder="AUTORIZADO / SUSPENDIDO..." autocomplete="off">
        </div>
        <div class="field-group">
          <label>DÍAS DE APROBACIÓN</label>
          <input type="number" class="proa-input med-qf-dias nav-field" placeholder="N° días (Opcional)">
        </div>
        <div class="field-group">
          <label>USO ADECUADO DE ATB</label>
          <input type="text" data-ac="usoAdecuado" class="proa-input med-qf-uso nav-field" placeholder="Opcional..." autocomplete="off">
        </div>
        <div class="field-group">
          <label>VISADOR (QF / INFECTÓLOGO)</label>
          <input type="text" data-ac="visadores" class="proa-input med-qf-visador nav-field" value="${PERFIL_ACTUAL.rol === 'QF' ? (PERFIL_ACTUAL.nombre || '') : ''}" placeholder="Opcional..." autocomplete="off">
        </div>
      </div>

      <div class="qf-grid-fechas" style="grid-template-columns: 1fr 1fr 2fr; margin-bottom: 0;">
        <div class="field-group">
          <label>FECHA VISADO</label>
          <input type="text" class="proa-input med-qf-fechavisado" value="${hoyCL}" tabindex="-1">
        </div>
        <div class="field-group">
          <label>PACIENTE NO ENCONTRADO</label>
          <input type="text" data-ac="pacNoEncontrado" class="proa-input med-qf-pacnoenc nav-field" placeholder="Opcional..." autocomplete="off">
        </div>
        <div class="field-group">
          <label>OBSERVACIONES CLÍNICAS</label>
          <input type="text" class="proa-input med-qf-obs nav-field" placeholder="Opcional..." autocomplete="off">
        </div>
      </div>
    </div>
  `;

  contenedor.appendChild(wrapper);
  aplicarPermisosSegunRolUI();

  if (enfocarNuevo) {
    const inputAtb = wrapper.querySelector(".med-atb");
    if (inputAtb) inputAtb.focus();
  }
};

window.alCambiarEstadoEnIngreso = function(selectEl) {
  const val = selectEl.value.toUpperCase();
  const wrapper = selectEl.closest(".med-item-wrapper");
  const extraPanel = wrapper ? wrapper.querySelector(".qf-ingreso-extra-panel") : null;

  selectEl.classList.remove("qf-est-aprobado", "qf-est-solicitud", "qf-est-rechazado");
  if (val === "APROBADO") selectEl.classList.add("qf-est-aprobado");
  else if (val === "RECHAZADO") selectEl.classList.add("qf-est-rechazado");
  else selectEl.classList.add("qf-est-solicitud");

  if (extraPanel) {
    if (PERFIL_ACTUAL.rol === "QF" && (val === "APROBADO" || val === "RECHAZADO")) {
      extraPanel.style.display = "block";
      const inputConducta = wrapper.querySelector(".med-qf-conducta");
      if (inputConducta && !inputConducta.value) {
        inputConducta.value = val === "APROBADO" ? "AUTORIZADO" : "SUSPENDIDO";
      }
    } else {
      extraPanel.style.display = "none";
    }
  }
};

window.eliminarFilaMedicamento = function(btn) {
  const wrappers = document.querySelectorAll(".med-item-wrapper");
  if (wrappers.length > 1) btn.closest(".med-item-wrapper").remove();
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

// 3. AUTOCOMPLETADO EN INGRESO CON AUTO-GUIÓN
let SUGERENCIAS_RUT_ACTUALES = [];
let INDICE_SUG_RUT = 0;

function formatearRutConGuionAutomatico(valorRaw) {
  const limpio = valorRaw.trim().toUpperCase();
  if (limpio === "S" || limpio === "S/" || limpio === "S/R" || limpio === "NN") return limpio;

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
         onmousedown="event.preventDefault(); seleccionarPacienteSugeridoPorIndice(${idx});">
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

  const inputDig = document.getElementById("in-digitador");
  const primerAtb = document.querySelector(".med-atb");
  if (inputDig && !inputDig.value.trim()) {
    inputDig.focus();
  } else if (primerAtb) {
    primerAtb.focus();
  }
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

  const wrappersMed = document.querySelectorAll(".med-item-wrapper");
  const tratamientos = [];
  wrappersMed.forEach(wrap => {
    const med = wrap.querySelector(".med-atb").value.trim();
    if (med) {
      const est = wrap.querySelector(".med-estado").value;
      const esVisadoEnIngreso = PERFIL_ACTUAL.rol === "QF" && (est === "APROBADO" || est === "RECHAZADO");
      tratamientos.push({
        estado: est,
        medicamento: med,
        carga: wrap.querySelector(".med-carga").value,
        dosis: wrap.querySelector(".med-dosis").value.trim() || "S/D",
        frecuencia: wrap.querySelector(".med-frec").value.trim() || "24 HRS",
        diagnostico: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-diag")?.value.trim() || "") : "",
        tipoTratamiento: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-tipotto")?.value.trim() || "") : "",
        tipoTerapia: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-tipoterapia")?.value.trim() || "") : "",
        lugarInfeccion: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-lugar")?.value.trim() || "") : "",
        conducta: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-conducta")?.value.trim() || "") : "",
        diasAutorizacion: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-dias")?.value.trim() || null) : null,
        usoAdecuado: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-uso")?.value.trim() || "") : "",
        visador: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-visador")?.value.trim() || "") : "",
        fechaVisado: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-fechavisado")?.value.trim() || "") : "",
        pacienteNoEncontrado: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-pacnoenc")?.value.trim() || "") : "",
        observaciones: esVisadoEnIngreso ? (wrap.querySelector(".med-qf-obs")?.value.trim() || "") : ""
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

  let tGracia;
  if (est === "RECHAZADO" || est === "APROBADO" || est === "AUTORIZADO") {
    tGracia = -1;
  } else if (esCarga) {
    tGracia = 0 - diasTranscurridos;
  } else {
    tGracia = (f.dias_predeterminados - 1) - diasTranscurridos;
  }

  const diasAut = f.dias_autorizacion ? Number(f.dias_autorizacion) : 0;
  let tAut;
  if (est === "RECHAZADO") {
    tAut = -1;
  } else if (esCarga && (est === "APROBADO" || est === "AUTORIZADO")) {
    tAut = 0 - diasTranscurridos;
  } else {
    tAut = diasAut > 0 ? (diasAut - 1) - diasTranscurridos : -1 - diasTranscurridos;
  }

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
  const ventana = document.getElementById("filtro-matriz-ventana")?.value || "ACTIVOS_7D";
  const filtroEst = document.getElementById("filtro-matriz-estado")?.value || "TODOS";
  const filtroSrv = document.getElementById("filtro-matriz-servicio")?.value || "TODOS";
  const orden = document.getElementById("filtro-matriz-orden")?.value || "ASC";
  const texto = (document.getElementById("filtro-matriz-texto")?.value || "").trim().toUpperCase();

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

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

  const esQF = PERFIL_ACTUAL.rol === "QF";

  const htmlFilasExistentes = filasFiltradas.map(f => {
    const m = calcularMetricasFila(f);
    const semG = m.tGracia >= 0 ? "sem-verde" : "sem-rojo";
    const semA = m.tAut >= 0 ? "sem-verde" : "sem-rojo";
    const estUpper = f.estado.toUpperCase();
    const diasVal = f.dias_autorizacion !== null && f.dias_autorizacion !== undefined ? f.dias_autorizacion : "";

    const limpiarNombre = (nom) => {
      if (!nom) return "";
      return String(nom).toUpperCase() === "BARRA.FRANCISCO30" ? "FRANCISCO BARRA" : nom;
    };
    f.digitador = limpiarNombre(f.digitador);
    f.visador = limpiarNombre(f.visador);

    const claseColorEstado = estUpper === "APROBADO"
      ? "est-sheet-aprobado"
      : estUpper === "RECHAZADO" ? "est-sheet-rechazado" : "est-sheet-solicitud";

    const celdaEstadoHTML = esQF
      ? `<select class="matrix-inline-select nav-field" onchange="guardarCeldaMatrizQF('${f.hashPaciente}', '${f.idTratamiento}', 'estado', this.value)">
           <option value="SOLICITUD" ${estUpper === "SOLICITUD" ? "selected" : ""}>SOLICITUD</option>
           <option value="APROBADO" ${estUpper === "APROBADO" ? "selected" : ""}>APROBADO</option>
           <option value="RECHAZADO" ${estUpper === "RECHAZADO" ? "selected" : ""}>RECHAZADO</option>
         </select>`
      : `<span>${estUpper}</span>`;

    const celdaAzulEditable = (campo, valor, catalogoAC = "", anchoPx = 65) => {
      const valLimpio = limpiarNombre(valor || "");
      const valSeguro = String(valLimpio).replace(/"/g, "&quot;");
      const attrAC = catalogoAC ? `data-ac="${catalogoAC}"` : "";
      return `<input type="text" class="matrix-blue-input nav-field"
                     style="width: ${anchoPx}px; min-width: ${anchoPx}px;"
                     title="${valSeguro}"
                     ${attrAC}
                     data-hash="${f.hashPaciente}"
                     data-idtrat="${f.idTratamiento}"
                     data-campo="${campo}"
                     value="${valSeguro}"
                     onchange="guardarCeldaMatrizQF('${f.hashPaciente}', '${f.idTratamiento}', '${campo}', this.value)">`;
    };

    const celdaEditableQF = (campo, valor, catalogoAC = "", anchoPx = 75) => {
      const valLimpio = limpiarNombre(valor || "");
      const valSeguro = String(valLimpio).replace(/"/g, "&quot;");
      if (!esQF) {
        return `<span class="cell-readonly-ellipsis" style="width: ${anchoPx}px; max-width: ${anchoPx}px;" title="${valSeguro}">${valSeguro}</span>`;
      }
      const attrAC = catalogoAC ? `data-ac="${catalogoAC}"` : "";
      return `<input type="text" class="matrix-editable-input nav-field"
                     style="width: ${anchoPx}px; min-width: ${anchoPx}px;"
                     title="${valSeguro}"
                     ${attrAC}
                     data-hash="${f.hashPaciente}"
                     data-idtrat="${f.idTratamiento}"
                     data-campo="${campo}"
                     value="${valSeguro}"
                     onchange="guardarCeldaMatrizQF('${f.hashPaciente}', '${f.idTratamiento}', '${campo}', this.value)">`;
    };

    const celdaDiasAutHTML = esQF
      ? `<input type="number" class="matrix-inline-days nav-field" value="${diasVal}" placeholder="-"
                data-hash="${f.hashPaciente}" data-idtrat="${f.idTratamiento}" data-campo="dias_autorizacion"
                onchange="guardarCeldaMatrizQF('${f.hashPaciente}', '${f.idTratamiento}', 'dias_autorizacion', this.value)">`
      : `<b>${diasVal}</b>`;

    return `
      <tr>
        <td class="td-estado-cell ${claseColorEstado}">${celdaEstadoHTML}</td>
        <td class="td-azul">${celdaAzulEditable("antimicrobiano", f.antimicrobiano, "antimicrobianos", 118)}</td>
        <td class="td-azul" style="text-align:center;">${celdaAzulEditable("carga", f.carga, "", 32)}</td>
        <td class="td-azul">${celdaAzulEditable("dosis", f.dosis, "dosis", 48)}</td>
        <td class="td-azul">${celdaAzulEditable("frecuencia", f.frecuencia, "frecuencias", 44)}</td>
        <td class="td-azul">${celdaAzulEditable("fecha_inicio", f.fecha_inicio, "", 58)}</td>
        <td class="semaforo ${semG}">${m.tGracia}</td>
        <td class="semaforo ${semA}">${m.tAut}</td>
        <td class="td-azul">${celdaAzulEditable("servicio", f.servicio, "servicios", 62)}</td>
        <td class="td-azul">${celdaAzulEditable("cama", f.cama, "", 38)}</td>
        <td class="td-azul">${celdaAzulEditable("nombre", f.nombre, "", 56)}</td>
        <td class="td-azul">${celdaAzulEditable("apellido", f.apellido, "", 56)}</td>
        <td class="td-azul">${celdaAzulEditable("rut", f.rut, "", 66)}</td>
        <td class="td-azul">${celdaAzulEditable("digitador", f.digitador, "digitadores", 68)}</td>
        <!-- ZONA VERDE SIEMPRE A LA VISTA (W a Z) -->
        <td class="td-verde">${celdaEditableQF("diagnostico", f.diagnostico, "diagnosticos", 86)}</td>
        <td class="td-verde">${celdaEditableQF("tipo_tratamiento", f.tipo_tratamiento, "tipoTto", 62)}</td>
        <td class="td-verde">${celdaEditableQF("tipo_terapia", f.tipo_terapia, "tipoTerapia", 60)}</td>
        <td class="td-verde">${celdaEditableQF("lugar_infeccion", f.lugar_infeccion, "lugarInf", 68)}</td>
        <!-- ZONA AMARILLA (AA a AG) -->
        <td class="td-amarilla">${celdaEditableQF("conducta", f.conducta, "estadoClinico", 95)}</td>
        <td class="td-amarilla" style="text-align:center;">${celdaDiasAutHTML}</td>
        <td class="td-amarilla">${celdaEditableQF("uso_adecuado", f.uso_adecuado, "usoAdecuado", 110)}</td>
        <td class="td-amarilla">${celdaEditableQF("observaciones", f.observaciones, "", 110)}</td>
        <td class="td-amarilla">${celdaEditableQF("visador", f.visador, "visadores", 85)}</td>
        <td class="td-amarilla">${celdaEditableQF("fecha_visado", f.fecha_visado, "", 64)}</td>
        <td class="td-amarilla">${celdaEditableQF("paciente_no_encontrado", f.paciente_no_encontrado, "pacNoEncontrado", 95)}</td>
      </tr>
    `;
  }).join("");

  // FILA FINAL DE INGRESO EN VIVO DIRECTO EN LA MATRIZ GENERAL (CON ANCHOS COMPACTOS)
  const hoyCL = hoyFormateadoCL();
  const digActual = PERFIL_ACTUAL.nombre || "FRANCISCO BARRA";

  const selectNuevoEstadoMatriz = esQF
    ? `<select id="nm-estado" class="matrix-inline-select nav-field">
         <option value="SOLICITUD" selected>➕ SOLIC.</option>
         <option value="APROBADO">➕ APROB.</option>
         <option value="RECHAZADO">➕ RECHAZ.</option>
       </select>`
    : `<span title="TENS solo ingresa en estado SOLICITUD" style="font-size:9.5px;">➕ SOLIC.</span>
       <input type="hidden" id="nm-estado" value="SOLICITUD">`;

  const celdasNuevasVerdesAmarillas = esQF
    ? `
      <td class="td-verde"><input type="text" id="nm-diag" data-ac="diagnosticos" class="matrix-editable-input nav-field" style="width:86px; min-width:86px;" placeholder="+ Diag..."></td>
      <td class="td-verde"><input type="text" id="nm-tipotto" data-ac="tipoTto" class="matrix-editable-input nav-field" style="width:62px; min-width:62px;" placeholder="+ Tto..."></td>
      <td class="td-verde"><input type="text" id="nm-tipoterapia" data-ac="tipoTerapia" class="matrix-editable-input nav-field" style="width:60px; min-width:60px;" placeholder="+ Terap..."></td>
      <td class="td-verde"><input type="text" id="nm-lugar" data-ac="lugarInf" class="matrix-editable-input nav-field" style="width:68px; min-width:68px;" placeholder="+ Lugar..."></td>
      <td class="td-amarilla"><input type="text" id="nm-conducta" data-ac="estadoClinico" class="matrix-editable-input nav-field" style="width:95px; min-width:95px;" placeholder="+ Conducta..."></td>
      <td class="td-amarilla" style="text-align:center;"><input type="number" id="nm-dias" class="matrix-inline-days nav-field" placeholder="Días"></td>
      <td class="td-amarilla"><input type="text" id="nm-uso" data-ac="usoAdecuado" class="matrix-editable-input nav-field" style="width:110px; min-width:110px;" placeholder="+ Uso ATB..."></td>
      <td class="td-amarilla"><input type="text" id="nm-obs" class="matrix-editable-input nav-field" style="width:110px; min-width:110px;" placeholder="+ Obs..."></td>
      <td class="td-amarilla"><input type="text" id="nm-visador" data-ac="visadores" class="matrix-editable-input nav-field" style="width:85px; min-width:85px;" value="${digActual}"></td>
      <td class="td-amarilla"><input type="text" id="nm-fechavis" class="matrix-editable-input nav-field" style="width:64px; min-width:64px;" value="${hoyCL}"></td>
      <td class="td-amarilla" style="display:flex; gap:4px; align-items:center;">
        <input type="text" id="nm-pacnoenc" data-ac="pacNoEncontrado" class="matrix-editable-input nav-field new-mat-trigger-save" style="width:75px; min-width:75px;" placeholder="Opcional...">
        <button type="button" class="btn-add-med nav-field" style="margin:0; padding:3px 7px; font-size:9.5px; background:#22c55e; color:#fff; border:none;" onclick="guardarNuevoPacienteDesdeMatriz()">💾</button>
      </td>
    `
    : `
      <td class="td-verde"><input type="text" class="matrix-input-disabled-tens" style="width:86px; min-width:86px;" disabled placeholder="QF"></td>
      <td class="td-verde"><input type="text" class="matrix-input-disabled-tens" style="width:62px; min-width:62px;" disabled placeholder="QF"></td>
      <td class="td-verde"><input type="text" class="matrix-input-disabled-tens" style="width:60px; min-width:60px;" disabled placeholder="QF"></td>
      <td class="td-verde"><input type="text" class="matrix-input-disabled-tens" style="width:68px; min-width:68px;" disabled placeholder="QF"></td>
      <td class="td-amarilla"><input type="text" class="matrix-input-disabled-tens" style="width:95px; min-width:95px;" disabled placeholder="QF"></td>
      <td class="td-amarilla"><input type="text" class="matrix-input-disabled-tens" style="width:45px; min-width:45px;" disabled placeholder="-"></td>
      <td class="td-amarilla"><input type="text" class="matrix-input-disabled-tens" style="width:110px; min-width:110px;" disabled placeholder="QF"></td>
      <td class="td-amarilla"><input type="text" class="matrix-input-disabled-tens" style="width:110px; min-width:110px;" disabled placeholder="QF"></td>
      <td class="td-amarilla"><input type="text" class="matrix-input-disabled-tens" style="width:85px; min-width:85px;" disabled placeholder="QF"></td>
      <td class="td-amarilla"><input type="text" class="matrix-input-disabled-tens" style="width:64px; min-width:64px;" disabled placeholder="-"></td>
      <td class="td-amarilla">
        <button type="button" class="btn-add-med nav-field" style="margin:0; padding:4px 8px; font-size:10px; width:100%; justify-content:center; background:#22c55e; color:#fff; border:none;" onclick="guardarNuevoPacienteDesdeMatriz()">➕ Guardar</button>
      </td>
    `;

  const htmlFilaNueva = `
    <tr class="tr-nuevo-matriz">
      <td class="td-estado-cell est-sheet-solicitud">${selectNuevoEstadoMatriz}</td>
      <td class="td-azul"><input type="text" id="nm-atb" data-ac="antimicrobianos" class="matrix-blue-input nav-field" style="width:118px; min-width:118px;" placeholder="➕ Antibiótico..."></td>
      <td class="td-azul">
        <select id="nm-carga" class="matrix-blue-input nav-field" style="width:36px; min-width:36px; padding:0 2px;">
          <option value="NO">NO</option>
          <option value="SI">SI</option>
        </select>
      </td>
      <td class="td-azul"><input type="text" id="nm-dosis" data-ac="dosis" class="matrix-blue-input nav-field" style="width:48px; min-width:48px;" placeholder="+Dosis"></td>
      <td class="td-azul"><input type="text" id="nm-frec" data-ac="frecuencias" class="matrix-blue-input nav-field" style="width:44px; min-width:44px;" placeholder="+Frec"></td>
      <td class="td-azul"><input type="text" id="nm-fecha" class="matrix-blue-input" style="width:58px; min-width:58px;" value="${hoyCL}" tabindex="-1"></td>
      <td class="semaforo" style="background:#e2e8f0; color:#475569; font-size:9px;">NVO</td>
      <td class="semaforo" style="background:#e2e8f0; color:#475569;">-</td>
      <td class="td-azul"><input type="text" id="nm-servicio" data-ac="servicios" class="matrix-blue-input nav-field" style="width:62px; min-width:62px;" placeholder="+Serv."></td>
      <td class="td-azul"><input type="text" id="nm-cama" class="matrix-blue-input nav-field" style="width:38px; min-width:38px;" placeholder="+Cama"></td>
      <td class="td-azul"><input type="text" id="nm-nombre" class="matrix-blue-input nav-field" style="width:56px; min-width:56px;" placeholder="+Nombre"></td>
      <td class="td-azul"><input type="text" id="nm-apellido" class="matrix-blue-input nav-field" style="width:56px; min-width:56px;" placeholder="+Apell."></td>
      <td class="td-azul"><input type="text" id="nm-rut" class="matrix-blue-input nav-field" style="width:66px; min-width:66px;" placeholder="+RUT" oninput="this.value = formatearRutConGuionAutomatico(this.value)"></td>
      <td class="td-azul"><input type="text" id="nm-digitador" data-ac="digitadores" class="matrix-blue-input nav-field ${!esQF ? 'new-mat-trigger-save' : ''}" style="width:68px; min-width:68px;" value="${digActual}"></td>
      ${celdasNuevasVerdesAmarillas}
    </tr>
  `;

  tbody.innerHTML = htmlFilasExistentes + htmlFilaNueva;
};

window.guardarNuevoPacienteDesdeMatriz = async function() {
  const esQF = PERFIL_ACTUAL.rol === "QF";
  const atb = document.getElementById("nm-atb")?.value.trim();
  const servicio = document.getElementById("nm-servicio")?.value.trim();
  const nombre = document.getElementById("nm-nombre")?.value.trim();
  const apellido = document.getElementById("nm-apellido")?.value.trim();
  const rut = document.getElementById("nm-rut")?.value.trim();

  if (!atb || !servicio || !nombre || !rut) {
    mostrarModalFeedback("ERROR", "Error", "Para ingresar desde la matriz complete al menos: Antibiótico, Servicio, Nombre y RUT.");
    return;
  }

  const estadoElegido = esQF ? (document.getElementById("nm-estado")?.value || "SOLICITUD") : "SOLICITUD";
  const digitador = document.getElementById("nm-digitador")?.value.trim() || PERFIL_ACTUAL.nombre || "TENS";

  await registrarIngresoMultipleCifrado({
    rut,
    nombre,
    apellido: apellido || "S/A",
    servicio,
    cama: document.getElementById("nm-cama")?.value.trim() || "S/I",
    fecha: document.getElementById("nm-fecha")?.value.trim() || hoyFormateadoCL(),
    digitador,
    tratamientos: [{
      estado: estadoElegido,
      medicamento: atb,
      carga: document.getElementById("nm-carga")?.value || "NO",
      dosis: document.getElementById("nm-dosis")?.value.trim() || "S/D",
      frecuencia: document.getElementById("nm-frec")?.value.trim() || "24 HRS",
      diagnostico: esQF ? (document.getElementById("nm-diag")?.value.trim() || "") : "",
      tipoTratamiento: esQF ? (document.getElementById("nm-tipotto")?.value.trim() || "") : "",
      tipoTerapia: esQF ? (document.getElementById("nm-tipoterapia")?.value.trim() || "") : "",
      lugarInfeccion: esQF ? (document.getElementById("nm-lugar")?.value.trim() || "") : "",
      conducta: esQF ? (document.getElementById("nm-conducta")?.value.trim() || "") : "",
      diasAutorizacion: esQF ? (document.getElementById("nm-dias")?.value.trim() || null) : null,
      usoAdecuado: esQF ? (document.getElementById("nm-uso")?.value.trim() || "") : "",
      observaciones: esQF ? (document.getElementById("nm-obs")?.value.trim() || "") : "",
      visador: esQF ? (document.getElementById("nm-visador")?.value.trim() || "") : "",
      fechaVisado: esQF ? (document.getElementById("nm-fechavis")?.value.trim() || "") : "",
      pacienteNoEncontrado: esQF ? (document.getElementById("nm-pacnoenc")?.value.trim() || "") : ""
    }]
  });

  mostrarModalFeedback("SUCCESS", "¡Ingreso Exitoso!", `Paciente ${nombre.toUpperCase()} registrado desde la matriz.`, 1600);
  await registrarNotificacionPROA(`${digitador} ingresó desde la matriz a ${nombre.toUpperCase()} ${apellido.toUpperCase()} (${atb.toUpperCase()}).`, "INGRESO_MATRIZ");
  await cargarMatrizEnVivo();
  await cargarNotificacionesEnVivo();
};

window.guardarCeldaMatrizQF = async function(hashPaciente, idTratamiento, campo, nuevoValor) {
  const fila = MEMORIA_FILAS.find(x => x.hashPaciente === hashPaciente && x.idTratamiento === idTratamiento);
  if (!fila) return;

  const camposZonaAzul = ["antimicrobiano", "carga", "dosis", "frecuencia", "fecha_inicio", "servicio", "cama", "nombre", "apellido", "rut", "digitador"];
  if (PERFIL_ACTUAL.rol !== "QF" && !camposZonaAzul.includes(campo)) return;

  const elFoco = document.activeElement;
  const focoInfo = (elFoco && elFoco.dataset && elFoco.dataset.idtrat)
    ? { idtrat: elFoco.dataset.idtrat, campo: elFoco.dataset.campo }
    : null;

  const nombreUsuario = PERFIL_ACTUAL.nombre || "FRANCISCO BARRA";
  const hoyCL = hoyFormateadoCL();
  const camposUpdateTrat = {};
  let bovedaClinicaNueva = null;
  let bovedaIdentidadNueva = null;
  let nuevoServicioPac = null;

  if (campo === "estado") {
    const estNuevo = nuevoValor.toUpperCase();
    camposUpdateTrat.estado = estNuevo;
    camposUpdateTrat.visador = fila.visador || nombreUsuario;
    camposUpdateTrat.fecha_visado = fila.fecha_visado || hoyCL;

    if (estNuevo === "APROBADO") {
      camposUpdateTrat.conducta = fila.conducta || "AUTORIZADO";
      if (!fila.dias_autorizacion || Number(fila.dias_autorizacion) <= 0) {
        const pedir = prompt(`Ingrese los días de aprobación para ${fila.antimicrobiano} (${fila.nombre} ${fila.apellido}):`, "7");
        if (pedir === null) { renderizarTablaMatriz(); return; }
        camposUpdateTrat.dias_autorizacion = Number(pedir) || 7;
      }
    } else if (estNuevo === "RECHAZADO") {
      camposUpdateTrat.conducta = "SUSPENDIDO";
    }
  } else if (campo === "dias_autorizacion") {
    camposUpdateTrat.dias_autorizacion = nuevoValor !== "" ? Number(nuevoValor) : null;
    camposUpdateTrat.visador = fila.visador || nombreUsuario;
    camposUpdateTrat.fecha_visado = fila.fecha_visado || hoyCL;
  } else if (campo === "diagnostico" || campo === "observaciones") {
    bovedaClinicaNueva = {
      diagnostico: campo === "diagnostico" ? nuevoValor.trim().toUpperCase() : (fila.diagnostico || ""),
      observaciones: campo === "observaciones" ? nuevoValor.trim() : (fila.observaciones || "")
    };
  } else if (["rut", "nombre", "apellido", "cama"].includes(campo)) {
    bovedaIdentidadNueva = {
      rut: campo === "rut" ? nuevoValor : fila.rut,
      nombre: campo === "nombre" ? nuevoValor : fila.nombre,
      apellido: campo === "apellido" ? nuevoValor : fila.apellido,
      cama: campo === "cama" ? nuevoValor : fila.cama
    };
  } else if (campo === "servicio") {
    nuevoServicioPac = nuevoValor;
  } else {
    camposUpdateTrat[campo] = nuevoValor.trim().toUpperCase();
  }

  await actualizarRapidoDesdeMatriz(hashPaciente, idTratamiento, camposUpdateTrat, bovedaClinicaNueva, bovedaIdentidadNueva, nuevoServicioPac);

  // La campana de notificaciones será exclusiva cuando el QF apruebe o rechace un tratamiento
  if (campo === "estado") {
    const estadoAnterior = fila.estado.toUpperCase();
    const estNuevo = camposUpdateTrat.estado;
    const textoDias = estNuevo === "APROBADO" && camposUpdateTrat.dias_autorizacion ? ` por ${camposUpdateTrat.dias_autorizacion} días` : "";
    
    await registrarNotificacionPROA(
      `QF ${nombreUsuario} cambió el estado de ${fila.nombre} ${fila.apellido} (${fila.antimicrobiano}) de ${estadoAnterior} a ${estNuevo}${textoDias}.`,
      "VISACION"
    );
  }

  await cargarMatrizEnVivo();
  await cargarNotificacionesEnVivo();

  if (focoInfo) {
    const restaurarEl = document.querySelector(`[data-idtrat="${focoInfo.idtrat}"][data-campo="${focoInfo.campo}"]`);
    if (restaurarEl) restaurarEl.focus();
  }
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

  if (MODO_SIDEBAR === "PACIENTES" && !queryTxt && !VER_LISTA_PACIENTES_SIDEBAR && MEMORIA_FILAS.length > 0) {
    if (contChips) contChips.style.display = "none";

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
      <div class="notif-item" id="notif-row-${n.id}">
        <div style="flex-grow: 1;">
          <div>🧑‍⚕️ ${n.mensaje}</div>
          <span class="notif-time">🕒 ${n.fecha_hora}</span>
        </div>
        <button type="button" class="btn-del-notif" title="Eliminar esta notificación" onclick="borrarNotificacionIndividual(event, '${n.id}')">
          <span class="material-icons-round" style="font-size: 16px;">close</span>
        </button>
      </div>
    `).join("");
  } else {
    badge.style.display = "none";
    cont.innerHTML = `<div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 12px;">Sin notificaciones registradas aún.</div>`;
  }
};

window.borrarNotificacionIndividual = async function(e, idNotif) {
  e.stopPropagation();
  const filaDOM = document.getElementById(`notif-row-${idNotif}`);
  if (filaDOM) filaDOM.style.opacity = "0.3";

  await eliminarNotificacionPROA(idNotif);
  await cargarNotificacionesEnVivo();
};

// =========================================================================
// 8. ESTACIÓN COMPLETA DE AUDITORÍA CLÍNICA (QF)
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

  const activos = [];
  const finalizados = [];

  filasDelPaciente.forEach(f => {
    const m = calcularMetricasFila(f);
    if (m.esVigente || f.estado.toUpperCase() === "SOLICITUD") activos.push(f);
    else finalizados.push(f);
  });

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
    const estUpper = (t.estado || "").toUpperCase();
    if (estUpper === "APROBADO" || estUpper === "RECHAZADO") {
      const diasTxt = t.diasAprob ? ` por ${t.diasAprob} días` : "";
      await registrarNotificacionPROA(
        `QF ${t.visador || PERFIL_ACTUAL.nombre} ${estUpper === "APROBADO" ? "aprobó" : "rechazó"} el tratamiento de ${nomPac} (${t.antimicrobiano})${diasTxt}.`,
        "VISACION"
      );
    }
  }
  await cargarNotificacionesEnVivo();

  btn.innerHTML = `<span class="material-icons-round" style="font-size: 19px;">save</span> <span>GUARDAR VISACIÓN Y SINCRONIZAR</span>`;
  btn.disabled = false;

  cerrarModalVisacion();
  await cargarMatrizEnVivo();
};

// =========================================================================
// MOTOR DE TEMA Y BOTONES CIRCULARES ESTILO FARMAPERFIL
// =========================================================================
let MODO_TEMA_ACTUAL = localStorage.getItem("proa_v4_theme_mode") || "LIGHT";

window.cambiarTemaPROA = function(modo) {
  MODO_TEMA_ACTUAL = modo;
  localStorage.setItem("proa_v4_theme_mode", modo);

  let usarOscuro = false;
  if (modo === "DARK") {
    usarOscuro = true;
  } else if (modo === "AUTO") {
    const prefiereSistemaOscuro = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const horaActual = new Date().getHours();
    usarOscuro = prefiereSistemaOscuro || (horaActual >= 20 || horaActual < 7);
  }

  document.body.classList.toggle("dark-mode", usarOscuro);

  const iconEl = document.getElementById("icon-fp-theme");
  const btnEl = document.getElementById("btn-fp-theme");
  if (iconEl) {
    iconEl.innerText = modo === "DARK" ? "light_mode" : modo === "AUTO" ? "brightness_auto" : "dark_mode";
  }
  if (btnEl) {
    btnEl.title = `Tema actual: ${modo === "DARK" ? "Modo Noche" : modo === "AUTO" ? "Automático" : "Modo Día"} (Clic para cambiar)`;
  }
};

window.ciclarTemaFarmaPerfil = function() {
  const orden = ["LIGHT", "DARK", "AUTO"];
  const sig = orden[(orden.indexOf(MODO_TEMA_ACTUAL) + 1) % orden.length];
  cambiarTemaPROA(sig);
};

// 2. BOTÓN HOME: Cierra la sesión actual y lleva directo a la pantalla de Login para iniciar con otra cuenta
window.irAInicioFarmaPerfil = async function() {
  await cerrarSesion();
  document.getElementById("panel-notificaciones").style.display = "none";
  document.getElementById("modal-visacion-qf").style.display = "none";
  document.getElementById("vista-login").style.display = "flex";
  document.getElementById("btn-login").disabled = false;
  document.getElementById("txt-btn-login").innerText = "DESBLOQUEAR SISTEMA";
  document.getElementById("login-email")?.focus();
};

// 3. BOTÓN ? : TOUR GUIADO INTERACTIVO PASO A PASO POR LA APP
const PASOS_TOUR_PROA = [
  {
    selector: ".ingreso-window",
    titulo: "1. Ingreso Rápido sin Mouse",
    texto: "Ingresa pacientes a máxima velocidad: el RUT se formatea solo y autocompleta datos previos. Usa Enter, Tab o las Flechas (↑ ↓ ← →) para moverte o retroceder sin tocar el mouse. Si eres QF y eliges Aprobado/Rechazado, se desplegarán los campos clínicos opcionales."
  },
  {
    selector: ".matrix-container",
    titulo: "2. Matriz en Tiempo Real e Independiente",
    texto: "A diferencia de las hojas de cálculo antiguas, filtrar aquí es 100% personal y jamás mueve ni interrumpe la pantalla de tus compañeros. Puedes desplazarte por las celdas con las flechas del teclado, editar en vivo y registrar pacientes directamente en la última fila."
  },
  {
    selector: ".search-sidebar",
    titulo: "3. Monitor en Vivo y Buscador Clínico",
    texto: "Cuando no estás buscando, el panel rota cada 5 segundos mostrando métricas por servicio y el ranking de antimicrobianos. En la pestaña 'Servicios' puedes filtrar con un solo clic y ver el historial acumulado de días por paciente."
  },
  {
    selector: "#btn-top-auditoria-qf",
    titulo: "4. Estación de Auditoría y Roles (QF / TENS)",
    texto: "El sistema adapta sus funciones según tu rol: los perfiles TENS ingresan solicitudes de forma segura en la zona azul, mientras que los Químicos Farmacéuticos cuentan con edición completa de las zonas verde/amarilla y esta Estación de Auditoría."
  },
  {
    selector: ".farmaperfil-icon-bar",
    titulo: "5. Centro de Control Rápido",
    texto: "• 🔔 Campana: Revisa la actividad clínica en tiempo real y borra notificaciones antiguas una a una.\n• 🏠 Inicio: Cierra tu turno y vuelve al login para entrar con otra cuenta.\n• 🌙 Tema: Alterna entre Modo Día, Noche y Automático."
  }
];

let INDICE_PASO_TOUR = 0;

window.mostrarAyudaTecladoPROA = function() {
  // Si el panel de ingreso está minimizado, lo expandimos para que se vea bien en el paso 1
  const bodyIngreso = document.getElementById("cuerpo-formulario-ingreso");
  if (bodyIngreso && bodyIngreso.classList.contains("minimizado")) {
    toggleMinimizarIngreso();
  }

  if (!document.getElementById("proa-tour-card")) {
    const card = document.createElement("div");
    card.id = "proa-tour-card";
    document.body.appendChild(card);
  }

  INDICE_PASO_TOUR = 0;
  renderizarPasoTourPROA();
};

function renderizarPasoTourPROA() {
  document.querySelectorAll(".tour-spotlight-active").forEach(el => el.classList.remove("tour-spotlight-active"));

  const card = document.getElementById("proa-tour-card");
  const paso = PASOS_TOUR_PROA[INDICE_PASO_TOUR];
  if (!paso || !card) {
    cerrarTourPROA();
    return;
  }

  let targetEl = document.querySelector(paso.selector);
  if (!targetEl || targetEl.offsetParent === null) {
    targetEl = document.querySelector(".top-header");
  }

  targetEl.classList.add("tour-spotlight-active");
  targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

  card.innerHTML = `
    <div class="tour-step-header">
      <span class="tour-step-badge">Paso ${INDICE_PASO_TOUR + 1} de ${PASOS_TOUR_PROA.length}</span>
      <button onclick="cerrarTourPROA()" style="border:none; background:none; color:#94a3b8; cursor:pointer; font-size:16px; font-weight:800;" title="Cerrar Tour">✕</button>
    </div>
    <div class="tour-title">${paso.titulo}</div>
    <div class="tour-desc" style="white-space: pre-line;">${paso.texto}</div>
    <div class="tour-footer">
      <button type="button" class="tour-btn tour-btn-prev" onclick="cambiarPasoTourPROA(-1)" style="visibility: ${INDICE_PASO_TOUR === 0 ? 'hidden' : 'visible'};">← Anterior</button>
      <button type="button" class="tour-btn tour-btn-next" onclick="cambiarPasoTourPROA(1)">
        ${INDICE_PASO_TOUR === PASOS_TOUR_PROA.length - 1 ? "Finalizar Tour ✓" : "Siguiente →"}
      </button>
    </div>
  `;

  card.style.display = "flex";

  // Posicionar la tarjeta flotante junto a la zona iluminada sin salirse de la pantalla
  const rect = targetEl.getBoundingClientRect();
  const cardWidth = 380;
  const cardHeight = card.offsetHeight || 230;

  let topPos = rect.bottom + 14;
  let leftPos = rect.left + 16;

  // Si el elemento ocupa casi toda la altura (ej. barra lateral derecha o matriz inferior), ajustamos posición
  if (paso.selector === ".search-sidebar") {
    leftPos = rect.left - cardWidth - 16;
    topPos = Math.max(20, rect.top + 60);
  } else if (topPos + cardHeight > window.innerHeight - 16) {
    topPos = Math.max(20, rect.top - cardHeight - 14);
  }

  if (leftPos + cardWidth > window.innerWidth - 16) {
    leftPos = window.innerWidth - cardWidth - 16;
  }
  if (leftPos < 16) leftPos = 16;

  card.style.top = `${topPos}px`;
  card.style.left = `${leftPos}px`;
}

window.cambiarPasoTourPROA = function(delta) {
  INDICE_PASO_TOUR += delta;
  if (INDICE_PASO_TOUR < 0 || INDICE_PASO_TOUR >= PASOS_TOUR_PROA.length) {
    cerrarTourPROA();
  } else {
    renderizarPasoTourPROA();
  }
};

window.cerrarTourPROA = function() {
  document.querySelectorAll(".tour-spotlight-active").forEach(el => el.classList.remove("tour-spotlight-active"));
  const card = document.getElementById("proa-tour-card");
  if (card) card.style.display = "none";
};

document.addEventListener("DOMContentLoaded", () => {
  cambiarTemaPROA(MODO_TEMA_ACTUAL);
});