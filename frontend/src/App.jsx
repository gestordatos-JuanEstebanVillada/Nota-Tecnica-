import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts";
import faviconSvg from "../IMG/logo.svg";
import logoLiga from "../IMG/logo.png";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

/** Lee cuerpo de respuesta HTTP; si no es JSON, devuelve mensaje legible con código de estado. */
async function parseApiResponse(res) {
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const raw = await res.text();
  if (!raw) {
    return { ok: res.ok, data: null, raw: "", parseError: null };
  }
  if (contentType.includes("application/json") || raw.trim().startsWith("{")) {
    try {
      return { ok: res.ok, data: JSON.parse(raw), raw, parseError: null };
    } catch (parseError) {
      return { ok: res.ok, data: null, raw, parseError };
    }
  }
  return { ok: res.ok, data: null, raw, parseError: null };
}

function mensajeErrorHttp(res, raw, data) {
  if (data?.detail) {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
    }
    return JSON.stringify(data.detail);
  }
  const cuerpo = (raw || "").trim().slice(0, 280);
  return cuerpo || `Error del servidor (HTTP ${res.status})`;
}

const formatCOP = (val) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(val || 0);

const formatNum = (val, dec = 2) =>
  new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(val || 0);

const MESES_PGP = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MESES_KEYS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
  "acumulado",
];

const OPCIONES_EMPRESA_PGP = [
  { value: "ALL", label: "Todas (10243 Contributivo + 10244 Subsidiado)" },
  { value: "10243", label: "10243 · EPS SANITAS CONTRIBUTIVO" },
  { value: "10244", label: "10244 · EPS SANITAS SUBSIDIADO" },
];

const MESES_GRAFICA = [
  { key: "enero", corto: "Ene", largo: "Enero" },
  { key: "febrero", corto: "Feb", largo: "Febrero" },
  { key: "marzo", corto: "Mar", largo: "Marzo" },
  { key: "abril", corto: "Abr", largo: "Abril" },
  { key: "mayo", corto: "May", largo: "Mayo" },
  { key: "junio", corto: "Jun", largo: "Junio" },
  { key: "julio", corto: "Jul", largo: "Julio" },
  { key: "agosto", corto: "Ago", largo: "Agosto" },
  { key: "septiembre", corto: "Sep", largo: "Septiembre" },
  { key: "octubre", corto: "Oct", largo: "Octubre" },
  { key: "noviembre", corto: "Nov", largo: "Noviembre" },
  { key: "diciembre", corto: "Dic", largo: "Diciembre" },
];

const MESES_PGP_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const PAGE_SIZE_PACIENTES = 50;

function CustomTooltipPacientes({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white/95 backdrop-blur-xs border border-slate-200 shadow-xl rounded-xl p-3 text-xs text-slate-700 min-w-[210px]">
      <p className="font-bold text-[#1B2A59] text-sm mb-1.5 border-b border-slate-100 pb-1">{d.largo}</p>
      <div className="flex items-center justify-between font-bold text-[#1B2A59] mb-1">
        <span>Total Pacientes:</span>
        <span>{Math.round(d.pacientesTotal).toLocaleString("es-CO")}</span>
      </div>
      <div className="flex items-center justify-between text-slate-600">
        <span>10243 Contributivo:</span>
        <span className="font-semibold">{Math.round(d.pacientes10243).toLocaleString("es-CO")}</span>
      </div>
      <div className="flex items-center justify-between text-slate-600">
        <span>10244 Subsidiado:</span>
        <span className="font-semibold">{Math.round(d.pacientes10244).toLocaleString("es-CO")}</span>
      </div>
    </div>
  );
}

function CustomTooltipValorPgp({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white/95 backdrop-blur-xs border border-[#F2C6D4] shadow-xl rounded-xl p-3 text-xs text-slate-700 min-w-[235px]">
      <p className="font-bold text-[#D81B60] text-sm mb-1.5 border-b border-[#FCE7EF] pb-1">{d.largo}</p>
      <div className="flex items-center justify-between font-bold text-[#1B2A59] mb-1">
        <span>Valor Total PGP:</span>
        <span>$ {Math.round(d.valorTotal).toLocaleString("es-CO")}</span>
      </div>
      <div className="flex items-center justify-between text-slate-600">
        <span>10243 Contributivo:</span>
        <span className="font-semibold">$ {Math.round(d.valor10243).toLocaleString("es-CO")}</span>
      </div>
      <div className="flex items-center justify-between text-slate-600">
        <span>10244 Subsidiado:</span>
        <span className="font-semibold">$ {Math.round(d.valor10244).toLocaleString("es-CO")}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("nt_token") || "");
  const [user, setUser] = useState(JSON.parse(localStorage.getItem("nt_user") || "null"));

  const [usuarioInput, setUsuarioInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  const [notasList, setNotasList] = useState([]);
  const [nota, setNota] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("TODOS");
  const [soloConFrecuencia, setSoloConFrecuencia] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [modalCupsAgrId, setModalCupsAgrId] = useState(null);
  const [nuevoCups, setNuevoCups] = useState({
    codigo_cups: "",
    descripcion: "",
    frecuencia_anual: 0,
    costo_medio_evento: 0,
    observacion: "",
  });
  const [modalObs, setModalObs] = useState(null);

  const [vistaActiva, setVistaActiva] = useState("NOTA_TECNICA");
  const anioActual = new Date().getFullYear();
  const [pgpFechaInicio, setPgpFechaInicio] = useState(`${anioActual}-01-01`);
  const [pgpFechaFin, setPgpFechaFin] = useState(`${anioActual}-12-31`);
  const [subVistaPgp, setSubVistaPgp] = useState("MENSUAL");
  const [resumenPgp, setResumenPgp] = useState([]);
  const [detallePacientesPgp, setDetallePacientesPgp] = useState([]);
  const [cargandoResumenPgp, setCargandoResumenPgp] = useState(false);
  const [cargandoDetallePgp, setCargandoDetallePgp] = useState(false);
  const [pacientesUnicosRango, setPacientesUnicosRango] = useState(null);
  const loadingPgp = cargandoResumenPgp || cargandoDetallePgp;
  const [busquedaPaciente, setBusquedaPaciente] = useState("");
  const [paginaPacientes, setPaginaPacientes] = useState(1);
  const [pgpConfigurado, setPgpConfigurado] = useState(true);
  const [pgpCodEmpresa, setPgpCodEmpresa] = useState("ALL");
  const [pgpAgrupador, setPgpAgrupador] = useState("ALL"); // locnom (hiloc); 'OTROS' si sin cruce
  const [pgpDx1Input, setPgpDx1Input] = useState("");
  const [opcionesAgrupador, setOpcionesAgrupador] = useState([]);
  const [dropdownEmpresaOpen, setDropdownEmpresaOpen] = useState(false);
  const [dropdownAgrupadorOpen, setDropdownAgrupadorOpen] = useState(false);
  const [busquedaAgrupador, setBusquedaAgrupador] = useState("");
  const dropdownEmpresaRef = useRef(null);
  const dropdownAgrupadorRef = useRef(null);
  const [mostrarGraficasPgp, setMostrarGraficasPgp] = useState(true);
  const [pgpFiltrosAplicados, setPgpFiltrosAplicados] = useState({
    fechaInicio: `${anioActual}-01-01`,
    fechaFin: `${anioActual}-12-31`,
    codEmpresa: "ALL",
    agrupador: "ALL",
    dx1: "",
  });

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = faviconSvg;
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("nt_token");
    localStorage.removeItem("nt_user");
    setToken("");
    setUser(null);
    setNota(null);
  };

  const resetContextoPgp = () => {
    setVistaActiva("NOTA_TECNICA");
    setResumenPgp([]);
    setDetallePacientesPgp([]);
    setPgpConfigurado(true);
    setBusquedaPaciente("");
    setPaginaPacientes(1);
    setPgpCodEmpresa("ALL");
    setPgpAgrupador("ALL");
    setPgpDx1Input("");
    setOpcionesAgrupador([]);
    setDropdownEmpresaOpen(false);
    setDropdownAgrupadorOpen(false);
    setBusquedaAgrupador("");
    setPgpFiltrosAplicados({
      fechaInicio: `${anioActual}-01-01`,
      fechaFin: `${anioActual}-12-31`,
      codEmpresa: "ALL",
      agrupador: "ALL",
      dx1: "",
    });
    setPacientesUnicosRango(null);
  };

  const cargarDetalleNota = async (idNota) => {
    resetContextoPgp();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/notas-tecnicas/${idNota}`, { headers: authHeaders });
      if (res.status === 401) return handleLogout();
      const data = await res.json();
      setNota(data);
      setExpandedGroups({});
    } finally {
      setLoading(false);
    }
  };

  const cargarListaNotas = async () => {
    const res = await fetch(`${API_URL}/notas-tecnicas`, { headers: authHeaders });
    if (res.status === 401) return handleLogout();
    const list = await res.json();
    setNotasList(list);
    if (list.length > 0 && !nota) {
      await cargarDetalleNota(list[0].id_nota);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: usuarioInput, password: passwordInput }),
      });
      const { data, raw, parseError } = await parseApiResponse(res);
      if (parseError) {
        throw new Error(`Respuesta inválida del servidor (HTTP ${res.status}). ${raw.slice(0, 120)}`);
      }
      if (!res.ok) throw new Error(mensajeErrorHttp(res, raw, data));
      if (!data?.access_token) throw new Error("El servidor no devolvió un token de sesión.");
      localStorage.setItem("nt_token", data.access_token);
      localStorage.setItem("nt_user", JSON.stringify(data.user));
      setToken(data.access_token);
      setUser(data.user);
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) cargarListaNotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const cargarDatosPgp = async (
    idNota = nota?.id_nota,
    fIni = pgpFechaInicio,
    fFin = pgpFechaFin,
    codEmp = pgpCodEmpresa,
    agr = pgpAgrupador,
    dx1Val = pgpDx1Input
  ) => {
    if (!idNota) return;
    setCargandoResumenPgp(true);
    setCargandoDetallePgp(true);

    const params = new URLSearchParams({
      fecha_inicio: fIni,
      fecha_fin: fFin,
      codempresa: codEmp || "ALL",
      agrupador: agr || "ALL",
      dx1: (dx1Val || "").trim(),
    });

    const reqResumen = fetch(
      `${API_URL}/notas-tecnicas/${idNota}/pgp-resumen-mensual?${params.toString()}`,
      { headers: authHeaders }
    )
      .then(async (res) => {
        if (res.status === 401) {
          handleLogout();
          throw new Error("Sesión expirada");
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Error cargando resumen mensual PGP");
        setPgpConfigurado(data.configurado !== false);
        setResumenPgp(data.data || []);
        if (Array.isArray(data.agrupadores)) {
          setOpcionesAgrupador(data.agrupadores);
        }
        if (typeof data.pacientes_unicos_rango === "number") {
          setPacientesUnicosRango(data.pacientes_unicos_rango);
        }
        setPaginaPacientes(1);
        setPgpFiltrosAplicados({
          fechaInicio: fIni,
          fechaFin: fFin,
          codEmpresa: codEmp || "ALL",
          agrupador: agr || "ALL",
          dx1: (dx1Val || "").trim(),
        });
      })
      .catch((err) => {
        console.error(err);
        alert(err.message);
      })
      .finally(() => setCargandoResumenPgp(false));

    const reqDetalle = fetch(
      `${API_URL}/notas-tecnicas/${idNota}/pgp-detalle-pacientes?${params.toString()}`,
      { headers: authHeaders }
    )
      .then(async (res) => {
        if (res.status === 401) {
          handleLogout();
          throw new Error("Sesión expirada");
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Error cargando detalle de pacientes PGP");
        setDetallePacientesPgp(data.data || []);
        if (data.configurado === false) {
          setPgpConfigurado(false);
        }
      })
      .catch((err) => {
        console.error(err);
        alert(err.message);
      })
      .finally(() => setCargandoDetallePgp(false));

    await Promise.all([reqResumen, reqDetalle]);
  };

  useEffect(() => {
    if (token && vistaActiva === "PACIENTES_PGP" && nota?.id_nota) {
      cargarDatosPgp(
        nota.id_nota,
        pgpFechaInicio,
        pgpFechaFin,
        pgpCodEmpresa,
        pgpAgrupador,
        pgpDx1Input
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, vistaActiva, nota?.id_nota]);

  useEffect(() => {
    setPaginaPacientes(1);
  }, [busquedaPaciente, subVistaPgp]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownAgrupadorRef.current && !dropdownAgrupadorRef.current.contains(event.target)) {
        setDropdownAgrupadorOpen(false);
      }
      if (dropdownEmpresaRef.current && !dropdownEmpresaRef.current.contains(event.target)) {
        setDropdownEmpresaOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleImportExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setLoadingMsg("Importando 1.188 registros a Oracle...");
    try {
      const res = await fetch(`${API_URL}/notas-tecnicas/importar`, {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      const errData = await res.json().catch(() => ({ detail: "Error interno en el servidor" }));
      if (!res.ok) {
        const detail = errData.detail;
        throw new Error(
          typeof detail === "string" ? detail : JSON.stringify(detail) || "Error importando Excel"
        );
      }
      await cargarListaNotas();
      await cargarDetalleNota(errData.id_nota);
      if (errData.mensaje) alert(errData.mensaje);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
      setLoadingMsg("");
      e.target.value = "";
    }
  };

  const handleCellChange = (idAgrupador, idDetalle, field, rawVal) => {
    const isTextField = field === "codigo_cups" || field === "descripcion";
    const cleanVal = isTextField ? rawVal : (isNaN(parseFloat(rawVal)) ? 0 : parseFloat(rawVal));

    setNota((prev) => ({
      ...prev,
      agrupadores: prev.agrupadores.map((agr) => {
        if (agr.id_agrupador !== idAgrupador) return agr;
        return {
          ...agr,
          detalles: agr.detalles.map((det) =>
            det.id_detalle === idDetalle ? { ...det, [field]: cleanVal } : det
          ),
        };
      }),
    }));
  };

  const esEstadoCotizaciones = (estado) => estado === "COTIZACIONES" || estado === "CONTRATACION";

  const handleEliminarCupsNuevo = async (idAgrupador, det) => {
    if (!det.estado_contratacion) return;
    const confirmar = window.confirm(
      `¿Deseas eliminar el CUPS nuevo "${det.codigo_cups} - ${det.descripcion}"?`
    );
    if (!confirmar) return;

    try {
      const res = await fetch(`${API_URL}/detalle-cups/${det.id_detalle}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const { data, raw } = await parseApiResponse(res);
      if (!res.ok) throw new Error(mensajeErrorHttp(res, raw, data));
      setNota((prev) => ({
        ...prev,
        agrupadores: prev.agrupadores.map((agr) =>
          agr.id_agrupador !== idAgrupador
            ? agr
            : {
                ...agr,
                detalles: agr.detalles.filter((d) => d.id_detalle !== det.id_detalle),
              }
        ),
      }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleEstado = async (idAgrupador, idDetalle, estadoActual) => {
    const nuevoEstado = esEstadoCotizaciones(estadoActual) ? "OK" : "COTIZACIONES";
    try {
      const res = await fetch(`${API_URL}/detalle-cups/${idDetalle}/estado`, {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ estado_contratacion: nuevoEstado }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || "No se pudo cambiar el estado");
      }
      setNota((prev) => ({
        ...prev,
        agrupadores: prev.agrupadores.map((agr) => {
          if (agr.id_agrupador !== idAgrupador) return agr;
          return {
            ...agr,
            detalles: agr.detalles.map((det) =>
              det.id_detalle === idDetalle
                ? { ...det, estado_contratacion: nuevoEstado }
                : det
            ),
          };
        }),
      }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSaveChanges = async () => {
    if (!nota) return;
    setGuardando(true);
    try {
      const detallesFlat = nota.agrupadores.flatMap((a) =>
        a.detalles.map((d) => ({
          id_detalle: d.id_detalle,
          codigo_cups: d.estado_contratacion ? d.codigo_cups : null,
          descripcion: d.estado_contratacion ? d.descripcion : null,
          frecuencia_anual: d.frecuencia_anual,
          costo_medio_evento: d.costo_medio_evento,
        }))
      );
      const res = await fetch(`${API_URL}/notas-tecnicas/${nota.id_nota}`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ poblacion: nota.poblacion, detalles: detallesFlat }),
      });
      if (!res.ok) throw new Error("No se pudieron guardar los cambios");
      alert("Nota Técnica actualizada en Oracle correctamente.");
    } catch (err) {
      alert(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleGuardarObservacion = async (e) => {
    e.preventDefault();
    if (!modalObs) return;
    setModalObs((prev) => ({ ...prev, guardando: true }));
    try {
      const res = await fetch(`${API_URL}/detalle-cups/${modalObs.det.id_detalle}/observacion`, {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ observacion: modalObs.textoObs }),
      });
      const { data, raw } = await parseApiResponse(res);
      if (!res.ok) throw new Error(mensajeErrorHttp(res, raw, data));
      setNota((prev) => ({
        ...prev,
        agrupadores: prev.agrupadores.map((agr) =>
          agr.id_agrupador !== modalObs.idAgrupador
            ? agr
            : {
                ...agr,
                detalles: agr.detalles.map((d) =>
                  d.id_detalle === modalObs.det.id_detalle
                    ? { ...d, observacion: data.observacion }
                    : d
                ),
              }
        ),
      }));
      setModalObs(null);
    } catch (err) {
      alert(err.message);
      setModalObs((prev) => (prev ? { ...prev, guardando: false } : null));
    }
  };

  const handleAgregarCupsSubmit = async (e) => {
    e.preventDefault();
    if (!modalCupsAgrId) return;
    const agrId = modalCupsAgrId;
    const res = await fetch(`${API_URL}/agrupadores/${agrId}/cups`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        codigo_cups: nuevoCups.codigo_cups,
        descripcion: nuevoCups.descripcion,
        frecuencia_anual: parseFloat(nuevoCups.frecuencia_anual) || 0,
        costo_medio_evento: parseFloat(nuevoCups.costo_medio_evento) || 0,
        observacion: nuevoCups.observacion,
      }),
    });
    if (res.ok) {
      setModalCupsAgrId(null);
      setNuevoCups({
        codigo_cups: "",
        descripcion: "",
        frecuencia_anual: 0,
        costo_medio_evento: 0,
        observacion: "",
      });
      setExpandedGroups((prev) => ({ ...prev, [agrId]: true }));
      await cargarDetalleNota(nota.id_nota);
      setExpandedGroups((prev) => ({ ...prev, [agrId]: true }));
    }
  };

  const calculos = useMemo(() => {
    if (!nota) return null;
    const poblacionNum = Number(nota.poblacion) || 0;
    let valorTotalMesBase = 0;

    const agrupadoresCalc = nota.agrupadores.map((agr) => {
      let freqAgr = 0;
      let evAnioAgr = 0;
      let evMesAgr = 0;
      let costoTotalAgr = 0;
      let cxuAgr = 0;

      const detallesCalc = agr.detalles.map((det) => {
        const freq = Number(det.frecuencia_anual) || 0;
        const cme = Number(det.costo_medio_evento) || 0;
        const eventosAnio = freq * poblacionNum;
        const eventosMes = eventosAnio / 12;
        const costoTotal = eventosMes * cme;
        const cxu = poblacionNum > 0 ? costoTotal / poblacionNum : 0;

        freqAgr += freq;
        evAnioAgr += eventosAnio;
        evMesAgr += eventosMes;
        costoTotalAgr += costoTotal;
        cxuAgr += cxu;

        if (!det.estado_contratacion) {
          valorTotalMesBase += costoTotal;
        }

        return {
          ...det,
          eventosAnio,
          eventosMes,
          eventoMes: eventosMes,
          costoTotal,
          cxu,
        };
      });

      const cmeAgr = evMesAgr > 0 ? costoTotalAgr / evMesAgr : 0;

      return {
        ...agr,
        detalles: detallesCalc,
        totales: {
          frecuencia_anual: freqAgr,
          eventosAnio: evAnioAgr,
          eventosMes: evMesAgr,
          costo_medio_evento: cmeAgr,
          costoTotal: costoTotalAgr,
          cxu: cxuAgr,
        },
      };
    });

    const cxuGlobal = poblacionNum > 0 ? valorTotalMesBase / poblacionNum : 0;
    const pctC = Number(nota.pct_contributivo) || 0.78;
    const contributivo = valorTotalMesBase * pctC;
    const subsidiado = valorTotalMesBase - contributivo;

    return {
      agrupadores: agrupadoresCalc,
      valorTotalMes: valorTotalMesBase,
      valorTotalMesGlobal: valorTotalMesBase,
      cxuGlobal,
      contributivo,
      subsidiado,
      valorContributivo: contributivo,
      valorSubsidiado: subsidiado,
    };
  }, [nota]);

  const toggleAgrupador = (idAgr) => {
    setExpandedGroups((prev) => ({ ...prev, [idAgr]: !prev[idAgr] }));
  };

  const expandirTodos = (expandir) => {
    if (!nota) return;
    if (!expandir) {
      setExpandedGroups({});
    } else {
      const all = {};
      nota.agrupadores.forEach((a) => {
        all[a.id_agrupador] = true;
      });
      setExpandedGroups(all);
    }
  };

  const handleNuevaPestana = () => {
    setNota(null);
    setExpandedGroups({});
    setFiltroTexto("");
    setFiltroEstado("TODOS");
    setSoloConFrecuencia(false);
    resetContextoPgp();
  };

  const tieneExcelCargado = Boolean(nota);
  const importBloqueado = tieneExcelCargado || loading;

  const kpiPgp = useMemo(() => {
    const totalPacientesAcum = resumenPgp
      .filter((r) => r.metrica === "Pacientes")
      .reduce((s, r) => s + (r.acumulado || 0), 0);
    const pacientesUnicos =
      typeof pacientesUnicosRango === "number"
        ? pacientesUnicosRango
        : new Set(detallePacientesPgp.map((p) => p.identificacion)).size;
    const valorTotal = detallePacientesPgp.reduce((s, p) => s + (p.total || 0), 0);
    return { totalPacientesAcum, pacientesUnicos, valorTotal };
  }, [resumenPgp, detallePacientesPgp, pacientesUnicosRango]);

  const totalesVerticalesPgp = useMemo(() => {
    const sumaPacientes = {};
    const sumaTotal = {};
    MESES_KEYS.forEach((k) => {
      sumaPacientes[k] = 0;
      sumaTotal[k] = 0;
    });

    resumenPgp.forEach((row) => {
      const destino = row.metrica === "Pacientes" ? sumaPacientes : sumaTotal;
      MESES_KEYS.forEach((k) => {
        destino[k] += Number(row[k]) || 0;
      });
    });

    return { pacientes: sumaPacientes, total: sumaTotal };
  }, [resumenPgp]);

  const datosGraficasMensualesPgp = useMemo(() => {
    return MESES_GRAFICA.map((m) => {
      let pacientesTotal = 0;
      let pacientes10243 = 0;
      let pacientes10244 = 0;
      let valorTotal = 0;
      let valor10243 = 0;
      let valor10244 = 0;

      resumenPgp.forEach((row) => {
        const val = Number(row[m.key]) || 0;
        const cod = String(row.codempresa || "");
        if (row.metrica === "Pacientes") {
          pacientesTotal += val;
          if (cod === "10243") pacientes10243 += val;
          if (cod === "10244") pacientes10244 += val;
        } else {
          valorTotal += val;
          if (cod === "10243") valor10243 += val;
          if (cod === "10244") valor10244 += val;
        }
      });

      return {
        ...m,
        pacientesTotal,
        pacientes10243,
        pacientes10244,
        valorTotal,
        valor10243,
        valor10244,
      };
    });
  }, [resumenPgp]);

  const detallePacientesFiltrados = useMemo(() => {
    const q = busquedaPaciente.trim().toLowerCase();
    if (!q) return detallePacientesPgp;
    return detallePacientesPgp.filter(
      (p) =>
        String(p.identificacion).toLowerCase().includes(q) ||
        String(p.nombres).toLowerCase().includes(q) ||
        String(p.empresa).toLowerCase().includes(q) ||
        String(p.mes).toLowerCase().includes(q)
    );
  }, [detallePacientesPgp, busquedaPaciente]);

  const totalPaginasPacientes = Math.max(1, Math.ceil(detallePacientesFiltrados.length / PAGE_SIZE_PACIENTES));
  const detallePacientesPagina = useMemo(() => {
    const start = (paginaPacientes - 1) * PAGE_SIZE_PACIENTES;
    return detallePacientesFiltrados.slice(start, start + PAGE_SIZE_PACIENTES);
  }, [detallePacientesFiltrados, paginaPacientes]);

  const agrupadoresFiltradosDropdown = useMemo(() => {
    const q = busquedaAgrupador
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (!q) return opcionesAgrupador;
    return opcionesAgrupador.filter((agr) =>
      agr
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .includes(q)
    );
  }, [opcionesAgrupador, busquedaAgrupador]);

  const filtrosPgpPendientes = useMemo(
    () =>
      pgpFechaInicio !== pgpFiltrosAplicados.fechaInicio ||
      pgpFechaFin !== pgpFiltrosAplicados.fechaFin ||
      pgpCodEmpresa !== pgpFiltrosAplicados.codEmpresa ||
      pgpAgrupador !== pgpFiltrosAplicados.agrupador ||
      (pgpDx1Input || "").trim() !== (pgpFiltrosAplicados.dx1 || "").trim(),
    [
      pgpFechaInicio,
      pgpFechaFin,
      pgpCodEmpresa,
      pgpAgrupador,
      pgpDx1Input,
      pgpFiltrosAplicados,
    ]
  );

  const aplicarFiltrosPgp = () => {
    if (!nota?.id_nota) return;
    setDropdownEmpresaOpen(false);
    setDropdownAgrupadorOpen(false);
    setPaginaPacientes(1);
    cargarDatosPgp(
      nota.id_nota,
      pgpFechaInicio,
      pgpFechaFin,
      pgpCodEmpresa,
      pgpAgrupador,
      pgpDx1Input
    );
  };

  const handleLimpiarFiltrosPgp = () => {
    setPgpCodEmpresa("ALL");
    setPgpAgrupador("ALL");
    setPgpDx1Input("");
    setDropdownEmpresaOpen(false);
    setDropdownAgrupadorOpen(false);
    setPaginaPacientes(1);
    if (nota?.id_nota) {
      cargarDatosPgp(nota.id_nota, pgpFechaInicio, pgpFechaFin, "ALL", "ALL", "");
    }
  };

  const filtrosPgpActivos =
    pgpCodEmpresa !== "ALL" || pgpAgrupador !== "ALL" || Boolean(pgpDx1Input.trim());

  const handleAnioActualPgp = () => {
    const ini = `${anioActual}-01-01`;
    const fin = `${anioActual}-12-31`;
    setPgpFechaInicio(ini);
    setPgpFechaFin(fin);
  };

  const renderVistaPacientesPgp = () => {
    if (!pgpConfigurado) {
      return (
        <div className="bg-white border border-[#F2C6D4] rounded-xl p-8 text-center shadow-sm space-y-3">
          <h2 className="text-base font-bold text-[#1B2A59]">
            Consulta de Pacientes PGP pendiente de configuración para {nota.contratante}
          </h2>
          <p className="text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
            Esta Nota Técnica pertenece a {nota.contratante} ({nota.consecutivo || "Sin consecutivo"}). Aún no se
            ha vinculado su consulta SQL de tmpbi1 para esta EPS.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <section className="bg-white border border-[#F2C6D4] rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1B2A59] mb-1">Fecha inicio</label>
              <input
                type="date"
                value={pgpFechaInicio}
                onChange={(e) => setPgpFechaInicio(e.target.value)}
                className="text-sm px-3 py-2 border border-[#F2C6D4] rounded-md focus:border-[#D81B60] focus:ring-2 focus:ring-[#D81B60]/15 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#1B2A59] mb-1">Fecha fin</label>
              <input
                type="date"
                value={pgpFechaFin}
                onChange={(e) => setPgpFechaFin(e.target.value)}
                className="text-sm px-3 py-2 border border-[#F2C6D4] rounded-md focus:border-[#D81B60] focus:ring-2 focus:ring-[#D81B60]/15 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={aplicarFiltrosPgp}
              disabled={loadingPgp}
              className={`bg-[#D81B60] hover:bg-[#B81450] disabled:opacity-60 text-white font-semibold text-xs px-4 py-2.5 rounded-md cursor-pointer ${
                filtrosPgpPendientes ? "ring-2 ring-amber-300 ring-offset-1" : ""
              }`}
            >
              {loadingPgp ? "Consultando..." : "Filtrar por Fecha"}
            </button>
            {filtrosPgpPendientes && (
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">
                Filtros pendientes — pulsa Filtrar
              </span>
            )}
            <button
              type="button"
              onClick={handleAnioActualPgp}
              disabled={loadingPgp}
              className="text-xs font-semibold px-4 py-2.5 rounded-md border border-[#F2C6D4] text-[#1B2A59] bg-[#FDF7F9] hover:bg-[#FCE7EF] cursor-pointer"
            >
              Año Actual (Ene - Dic)
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-[#F2C6D4]/60">
            <div ref={dropdownEmpresaRef} className="relative">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Empresa / Régimen</label>
              <button
                type="button"
                onClick={() => {
                  setDropdownEmpresaOpen((prev) => !prev);
                  setDropdownAgrupadorOpen(false);
                }}
                className={`w-80 px-3 py-2 text-sm bg-white border rounded-lg text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                  dropdownEmpresaOpen
                    ? "border-[#D81B60] ring-2 ring-[#D81B60]/15"
                    : "border-slate-300 hover:border-slate-400"
                }`}
              >
                <span className="truncate font-medium text-slate-800">
                  {OPCIONES_EMPRESA_PGP.find((opt) => opt.value === pgpCodEmpresa)?.label ||
                    "Todas (10243 Contributivo + 10244 Subsidiado)"}
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${
                    dropdownEmpresaOpen ? "rotate-180 text-[#D81B60]" : ""
                  }`}
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              {dropdownEmpresaOpen && (
                <div className="absolute left-0 mt-1.5 w-80 sm:w-96 bg-white border border-[#F2C6D4] rounded-xl shadow-xl z-40 overflow-hidden">
                  <div className="max-h-64 overflow-y-auto custom-scrollbar py-1 divide-y divide-slate-100">
                    {OPCIONES_EMPRESA_PGP.map((opt) => {
                      const activo = pgpCodEmpresa === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setPgpCodEmpresa(opt.value);
                            setDropdownEmpresaOpen(false);
                          }}
                          className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                            activo
                              ? "bg-[#FCE7EF] text-[#D81B60] font-bold"
                              : "text-slate-700 hover:bg-slate-50 font-medium"
                          }`}
                        >
                          <span className="leading-snug">{opt.label}</span>
                          {activo && <span className="shrink-0">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div ref={dropdownAgrupadorRef} className="relative">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Agrupador</label>
              <button
                type="button"
                onClick={() => {
                  setDropdownAgrupadorOpen((prev) => !prev);
                  setDropdownEmpresaOpen(false);
                  setBusquedaAgrupador("");
                }}
                className={`w-72 px-3 py-2 text-sm bg-white border rounded-lg text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                  dropdownAgrupadorOpen
                    ? "border-[#D81B60] ring-2 ring-[#D81B60]/15"
                    : "border-slate-300 hover:border-slate-400"
                }`}
              >
                <span className="truncate font-medium text-slate-800">
                  {pgpAgrupador === "ALL"
                    ? `Todos los Agrupadores (${opcionesAgrupador.length})`
                    : pgpAgrupador}
                </span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${
                    dropdownAgrupadorOpen ? "rotate-180 text-[#D81B60]" : ""
                  }`}
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>

              {dropdownAgrupadorOpen && (
                <div className="absolute left-0 mt-1.5 w-80 sm:w-96 bg-white border border-[#F2C6D4] rounded-xl shadow-xl z-40 overflow-hidden">
                  <div className="p-2.5 bg-[#FDF7F9] border-b border-[#F2C6D4]">
                    <div className="relative">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                      >
                        <path
                          fillRule="evenodd"
                          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <input
                        type="text"
                        autoFocus
                        value={busquedaAgrupador}
                        onChange={(e) => setBusquedaAgrupador(e.target.value)}
                        placeholder="Buscar agrupador..."
                        className="w-full pl-8 pr-7 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-[#D81B60]"
                      />
                      {busquedaAgrupador && (
                        <button
                          type="button"
                          onClick={() => setBusquedaAgrupador("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#D81B60] text-xs font-bold cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto custom-scrollbar py-1 divide-y divide-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setPgpAgrupador("ALL");
                        setDropdownAgrupadorOpen(false);
                        setBusquedaAgrupador("");
                      }}
                      className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between transition cursor-pointer ${
                        pgpAgrupador === "ALL"
                          ? "bg-[#FCE7EF] text-[#D81B60] font-bold"
                          : "text-slate-700 hover:bg-slate-50 font-medium"
                      }`}
                    >
                      <span>Todos los Agrupadores ({opcionesAgrupador.length})</span>
                      {pgpAgrupador === "ALL" && <span>✓</span>}
                    </button>

                    {agrupadoresFiltradosDropdown.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-slate-400">
                        No se encontraron agrupadores para &quot;{busquedaAgrupador}&quot;
                      </div>
                    ) : (
                      agrupadoresFiltradosDropdown.map((agr) => {
                        const activo = pgpAgrupador === agr;
                        return (
                          <button
                            key={agr}
                            type="button"
                            onClick={() => {
                              setPgpAgrupador(agr);
                              setDropdownAgrupadorOpen(false);
                              setBusquedaAgrupador("");
                            }}
                            className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                              activo
                                ? "bg-[#FCE7EF] text-[#D81B60] font-bold"
                                : "text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <span className="leading-snug">{agr}</span>
                            {activo && <span className="shrink-0">✓</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Código CIE-10 (dx1)</label>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="text"
                    value={pgpDx1Input}
                    onChange={(e) => setPgpDx1Input(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        aplicarFiltrosPgp();
                      }
                    }}
                    placeholder="Ej: C509 o MAMA..."
                    className="px-3 py-2 pr-7 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 w-44 uppercase placeholder:normal-case focus:outline-none focus:border-[#D81B60]"
                  />
                  {pgpDx1Input && (
                    <button
                      type="button"
                      onClick={() => setPgpDx1Input("")}
                      title="Borrar texto CIE-10"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#D81B60] text-xs font-bold cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={aplicarFiltrosPgp}
                  disabled={loadingPgp}
                  className={`px-4 py-2 text-sm font-semibold text-white bg-[#D81B60] hover:bg-[#B81450] disabled:opacity-60 rounded-lg shadow-xs transition cursor-pointer whitespace-nowrap ${
                    filtrosPgpPendientes ? "ring-2 ring-amber-300 ring-offset-1" : ""
                  }`}
                >
                  {loadingPgp ? "Consultando..." : "Filtrar"}
                </button>
              </div>
            </div>
            {filtrosPgpActivos && (
              <button
                type="button"
                onClick={handleLimpiarFiltrosPgp}
                disabled={loadingPgp}
                className="text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Limpiar Filtros
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSubVistaPgp("MENSUAL")}
              className={
                subVistaPgp === "MENSUAL"
                  ? "text-xs font-semibold px-4 py-2 rounded-full bg-[#D81B60] text-white cursor-pointer"
                  : "text-xs font-semibold px-4 py-2 rounded-full bg-[#FCE7EF] text-[#1B2A59] border border-[#F2C6D4] cursor-pointer"
              }
            >
              1. Consolidado Mensual (Ene - Dic)
            </button>
            <button
              type="button"
              onClick={() => setSubVistaPgp("DETALLE")}
              className={
                subVistaPgp === "DETALLE"
                  ? "text-xs font-semibold px-4 py-2 rounded-full bg-[#D81B60] text-white cursor-pointer"
                  : "text-xs font-semibold px-4 py-2 rounded-full bg-[#FCE7EF] text-[#1B2A59] border border-[#F2C6D4] cursor-pointer"
              }
            >
              2. Detalle Paciente por Paciente
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white border border-[#F2C6D4] rounded-xl p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase text-[#D81B60] tracking-wide">Pacientes atendidos</p>
            <p className="text-2xl font-bold text-[#1B2A59] mt-1">
              {Math.round(kpiPgp.totalPacientesAcum).toLocaleString("es-CO")}
            </p>
            <p className="text-xs text-slate-500 mt-1">Acumulado mensual (resumen)</p>
          </div>
          <div className="bg-white border border-[#F2C6D4] rounded-xl p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase text-[#D81B60] tracking-wide">Pacientes únicos</p>
            <p className="text-2xl font-bold text-[#1B2A59] mt-1">
              {kpiPgp.pacientesUnicos.toLocaleString("es-CO")}
            </p>
            <p className="text-xs text-slate-500 mt-1">En el rango de fechas</p>
          </div>
          <div className="bg-white border border-[#F2C6D4] rounded-xl p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase text-[#D81B60] tracking-wide">Valor total PGP</p>
            <p className="text-2xl font-bold text-[#1B2A59] mt-1">{formatCOP(kpiPgp.valorTotal)}</p>
            <p className="text-xs text-slate-500 mt-1">Suma detalle tmpbi1</p>
          </div>
        </section>

        {subVistaPgp === "MENSUAL" && resumenPgp.length > 0 && (
          <section className="bg-white border border-[#F2C6D4] rounded-xl shadow-sm p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-bold text-[#1B2A59]">Gráficas del consolidado mensual</h3>
              <button
                type="button"
                onClick={() => setMostrarGraficasPgp((v) => !v)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#F2C6D4] text-[#1B2A59] bg-[#FDF7F9] hover:bg-[#FCE7EF] cursor-pointer"
              >
                {mostrarGraficasPgp ? "Ocultar gráficas" : "Mostrar gráficas"}
              </button>
            </div>

            {mostrarGraficasPgp && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div>
                      <h4 className="text-sm font-bold text-[#1B2A59]">Pacientes Atendidos · Mes a Mes</h4>
                      <p className="text-xs text-slate-500">
                        Distribución mensual de atenciones según filtros aplicados
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#EEF2FF] text-[#1B2A59] border border-[#C7D2FE]">
                      {pgpFiltrosAplicados.fechaInicio} a {pgpFiltrosAplicados.fechaFin}
                    </span>
                  </div>
                  {datosGraficasMensualesPgp.every((d) => d.pacientesTotal === 0) ? (
                    <p className="text-xs text-slate-500 text-center py-16">
                      Sin movimientos registrados en el rango de fechas seleccionado.
                    </p>
                  ) : (
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={datosGraficasMensualesPgp} margin={{ top: 12, right: 4, left: -10, bottom: 4 }}>
                          <defs>
                            <linearGradient id="gradPacientesPgp" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#1B2A59" stopOpacity={1} />
                              <stop offset="100%" stopColor="#3B5998" stopOpacity={0.82} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="corto"
                            axisLine={{ stroke: "#CBD5E1" }}
                            tickLine={false}
                            tick={{ fill: "#475569", fontSize: 12, fontWeight: 600 }}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#64748B", fontSize: 11 }}
                          />
                          <Tooltip content={<CustomTooltipPacientes />} cursor={{ fill: "#F1F5F9", radius: 6 }} />
                          <Bar
                            dataKey="pacientesTotal"
                            fill="url(#gradPacientesPgp)"
                            radius={[6, 6, 0, 0]}
                            maxBarSize={36}
                            animationDuration={500}
                          >
                            <LabelList
                              dataKey="pacientesTotal"
                              position="top"
                              formatter={(val) => (val > 0 ? Math.round(val).toLocaleString("es-CO") : "")}
                              style={{ fill: "#1B2A59", fontSize: 11, fontWeight: 700 }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="bg-white border border-[#F2C6D4] rounded-2xl p-5 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div>
                      <h4 className="text-sm font-bold text-[#1B2A59]">Valor Total PGP ($) · Mes a Mes</h4>
                      <p className="text-xs text-slate-500">
                        Comportamiento mensual facturado en millones de pesos
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#FCE7EF] text-[#D81B60] border border-[#F2C6D4]">
                      {pgpFiltrosAplicados.fechaInicio} a {pgpFiltrosAplicados.fechaFin}
                    </span>
                  </div>
                  {datosGraficasMensualesPgp.every((d) => d.valorTotal === 0) ? (
                    <p className="text-xs text-slate-500 text-center py-16">
                      Sin movimientos registrados en el rango de fechas seleccionado.
                    </p>
                  ) : (
                    <div className="h-[300px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={datosGraficasMensualesPgp} margin={{ top: 16, right: 4, left: -4, bottom: 4 }}>
                          <defs>
                            <linearGradient id="gradValorPgp" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#D81B60" stopOpacity={0.32} />
                              <stop offset="100%" stopColor="#D81B60" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#FCE7EF" strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="corto"
                            axisLine={{ stroke: "#F2C6D4" }}
                            tickLine={false}
                            tick={{ fill: "#475569", fontSize: 12, fontWeight: 600 }}
                          />
                          <YAxis
                            width={66}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: "#64748B", fontSize: 11 }}
                            tickFormatter={(val) =>
                              val === 0 ? "$0" : `$${Math.round(val / 1_000_000).toLocaleString("es-CO")}M`
                            }
                          />
                          <Tooltip content={<CustomTooltipValorPgp />} />
                          <Area
                            type="monotone"
                            dataKey="valorTotal"
                            stroke="#D81B60"
                            strokeWidth={2.5}
                            fill="url(#gradValorPgp)"
                            animationDuration={500}
                            dot={{ fill: "#D81B60", stroke: "#FFFFFF", strokeWidth: 3, r: 4.5 }}
                            activeDot={{ r: 6.5, fill: "#D81B60", stroke: "#1B2A59", strokeWidth: 2 }}
                          >
                            <LabelList
                              dataKey="valorTotal"
                              position="top"
                              offset={10}
                              formatter={(val) =>
                                val > 0
                                  ? `$${Math.round(val / 1_000_000).toLocaleString("es-CO")}M`
                                  : ""
                              }
                              style={{ fill: "#B81450", fontSize: 10, fontWeight: 700 }}
                            />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {subVistaPgp === "MENSUAL" && (
          <section className="bg-white rounded-lg border border-[#F2C6D4] shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs min-w-[1200px]">
                <thead className="bg-[#F8E5EC] text-[#1B2A59] sticky top-0 z-10">
                  <tr>
                    <th className="border border-[#F2C6D4] px-2 py-2 text-left">Agrupa Empresa</th>
                    <th className="border border-[#F2C6D4] px-2 py-2 text-center">Tarifa</th>
                    <th className="border border-[#F2C6D4] px-2 py-2 text-center">Cod. Empresa</th>
                    <th className="border border-[#F2C6D4] px-2 py-2 text-left">Empresa</th>
                    <th className="border border-[#F2C6D4] px-2 py-2 text-center">Métrica</th>
                    {MESES_PGP_LABELS.map((m) => (
                      <th key={m} className="border border-[#F2C6D4] px-2 py-2 text-right whitespace-nowrap">
                        {m}
                      </th>
                    ))}
                    <th className="border border-[#F2C6D4] px-2 py-2 text-right font-bold">Total Rango</th>
                  </tr>
                </thead>
                <tbody>
                  {resumenPgp.map((row, idx) => {
                    const esPacientes = row.metrica === "Pacientes";
                    const esTotal = row.metrica === "Total";
                    const fmtVal = (val) =>
                      esPacientes
                        ? Math.round(val).toLocaleString("es-CO")
                        : `$ ${Math.round(val).toLocaleString("es-CO")}`;
                    return (
                      <tr
                        key={`${row.codempresa}-${row.metrica}-${idx}`}
                        className={esTotal ? "bg-[#FDF7F9] font-semibold" : "bg-white hover:bg-[#FCE7EF]/30"}
                      >
                        <td className="border border-[#F2C6D4] px-2 py-1.5">{row.agrupaempresa}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1.5 text-center">{row.tarifa}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1.5 text-center font-mono">{row.codempresa}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1.5">{row.empresa}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1.5 text-center">
                          {esPacientes ? (
                            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-[#1B2A59]/10 text-[#1B2A59] border border-[#1B2A59]/20">
                              Pacientes
                            </span>
                          ) : (
                            <span className="text-[#D81B60] font-semibold">Total</span>
                          )}
                        </td>
                        {MESES_PGP.map((mk) => (
                          <td key={mk} className="border border-[#F2C6D4] px-2 py-1.5 text-right font-mono">
                            {fmtVal(row[mk] || 0)}
                          </td>
                        ))}
                        <td className="border border-[#F2C6D4] px-2 py-1.5 text-right font-mono font-bold">
                          {fmtVal(row.acumulado || 0)}
                        </td>
                      </tr>
                    );
                  })}
                  {resumenPgp.length === 0 && !cargandoResumenPgp && (
                    <tr>
                      <td colSpan={17} className="text-center py-8 text-slate-500">
                        Sin datos para el rango seleccionado.
                      </td>
                    </tr>
                  )}
                </tbody>
                {resumenPgp.length > 0 && (
                  <tfoot className="border-t-2 border-[#1B2A59] sticky bottom-0 z-10">
                    <tr className="bg-[#EEF2FF] text-[#1B2A59] font-bold border-b border-[#CBD5E1]">
                      <td colSpan={4} className="border border-[#F2C6D4] px-3 py-2.5 text-left text-xs uppercase tracking-wide">
                        Total Consolidado · Todas las Empresas
                      </td>
                      <td className="border border-[#F2C6D4] px-3 py-2.5 text-center">
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-[#1B2A59] text-white">
                          Pacientes
                        </span>
                      </td>
                      {MESES_KEYS.map((mesKey) => (
                        <td
                          key={`tot-pac-${mesKey}`}
                          className={`border border-[#F2C6D4] px-3 py-2.5 text-right font-mono whitespace-nowrap ${
                            mesKey === "acumulado" ? "bg-[#E0E7FF] font-extrabold" : ""
                          }`}
                        >
                          {Math.round(totalesVerticalesPgp.pacientes[mesKey] || 0).toLocaleString("es-CO")}
                        </td>
                      ))}
                    </tr>
                    <tr className="bg-[#FCE7EF] text-[#1B2A59] font-bold">
                      <td
                        colSpan={4}
                        className="border border-[#F2C6D4] px-3 py-2.5 text-left text-xs uppercase tracking-wide text-[#D81B60]"
                      >
                        Total Consolidado · Valor ($)
                      </td>
                      <td className="border border-[#F2C6D4] px-3 py-2.5 text-center">
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-[#D81B60] text-white">
                          Total
                        </span>
                      </td>
                      {MESES_KEYS.map((mesKey) => (
                        <td
                          key={`tot-val-${mesKey}`}
                          className={`border border-[#F2C6D4] px-3 py-2.5 text-right font-mono whitespace-nowrap ${
                            mesKey === "acumulado" ? "bg-[#F8D0E0] text-[#B81450] font-extrabold" : ""
                          }`}
                        >
                          $ {Math.round(totalesVerticalesPgp.total[mesKey] || 0).toLocaleString("es-CO")}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        )}

        {subVistaPgp === "DETALLE" && (
          <section className="space-y-3">
            <input
              type="text"
              value={busquedaPaciente}
              onChange={(e) => setBusquedaPaciente(e.target.value)}
              placeholder="Buscar por identificación, nombres, empresa o mes (YYYY-MM)..."
              className="w-full max-w-xl text-xs px-3 py-2 border border-[#F2C6D4] rounded-md focus:ring-2 focus:ring-[#D81B60]/20 focus:border-[#D81B60] outline-none"
            />
            <div className="bg-white rounded-lg border border-[#F2C6D4] shadow-sm overflow-hidden">
              <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
                <table className="w-full border-collapse text-xs min-w-[1400px]">
                  <thead className="bg-[#F8E5EC] text-[#1B2A59] sticky top-0 z-10">
                    <tr>
                      <th className="border border-[#F2C6D4] px-2 py-2">Fecha</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Mes</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Agrupa Empresa</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Tarifa</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Cod. Empresa</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Empresa</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Fuente</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Identificación</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Nombres</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Agrupador</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">CIE-10 (dx1)</th>
                      <th className="border border-[#F2C6D4] px-2 py-2">Diagnóstico (dx1nom)</th>
                      <th className="border border-[#F2C6D4] px-2 py-2 text-right">Total ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detallePacientesPagina.map((p, i) => (
                      <tr key={`${p.identificacion}-${p.fecha}-${i}`} className="hover:bg-[#FDF7F9]">
                        <td className="border border-[#F2C6D4] px-2 py-1 font-mono">{p.fecha}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1 font-mono">{p.mes}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1">{p.agrupaempresa}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1 text-center">{p.tarifa}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1 text-center font-mono">{p.codempresa}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1">{p.empresa}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1 text-center">{p.fuente}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1 font-mono font-semibold">{p.identificacion}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1">{p.nombres}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1">{p.agrupador}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1 font-mono">{p.dx1}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1">{p.dx1nom}</td>
                        <td className="border border-[#F2C6D4] px-2 py-1 text-right font-mono">{formatCOP(p.total)}</td>
                      </tr>
                    ))}
                    {detallePacientesPagina.length === 0 && !cargandoDetallePgp && (
                      <tr>
                        <td colSpan={13} className="text-center py-8 text-slate-500">
                          Sin registros para el filtro aplicado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#1B2A59]">
              <span>
                Mostrando{" "}
                {detallePacientesFiltrados.length === 0 ? 0 : (paginaPacientes - 1) * PAGE_SIZE_PACIENTES + 1}–
                {Math.min(paginaPacientes * PAGE_SIZE_PACIENTES, detallePacientesFiltrados.length)} de{" "}
                {detallePacientesFiltrados.length.toLocaleString("es-CO")} registros
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={paginaPacientes <= 1}
                  onClick={() => setPaginaPacientes((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded border border-[#F2C6D4] bg-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <span className="font-semibold">
                  Pág. {paginaPacientes} / {totalPaginasPacientes}
                </span>
                <button
                  type="button"
                  disabled={paginaPacientes >= totalPaginasPacientes}
                  onClick={() => setPaginaPacientes((p) => Math.min(totalPaginasPacientes, p + 1))}
                  className="px-3 py-1.5 rounded border border-[#F2C6D4] bg-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  Siguiente
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    );
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#FDF4F6] flex items-center justify-center p-4 md:p-8 relative">
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute w-[500px] h-[500px] rounded-full bg-[#F8BBD0]/30 blur-3xl -top-32 -left-32" />
          <div className="absolute w-[500px] h-[500px] rounded-full bg-[#F8BBD0]/30 blur-3xl -bottom-32 -right-32" />
        </div>

        <div className="max-w-[880px] w-full bg-white rounded-3xl shadow-[0_12px_40px_rgba(216,27,96,0.08)] overflow-hidden grid grid-cols-1 md:grid-cols-2 min-h-[430px] relative z-10">
          <div className="bg-white p-10 md:p-12 flex flex-col justify-center">
            <h1 className="text-[#D81B60] font-semibold text-base mb-6">Nota Técnica PGP</h1>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1B2A59] mb-1.5">Usuario</label>
                <input
                  type="text"
                  required
                  value={usuarioInput}
                  onChange={(e) => setUsuarioInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm text-slate-700 placeholder-slate-400 bg-white border border-[#F2C6D4] rounded-md focus:outline-none focus:border-[#D81B60] focus:ring-2 focus:ring-[#D81B60]/15 transition"
                  placeholder="Usuario"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1B2A59] mb-1.5">Contraseña</label>
                <input
                  type="password"
                  required
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm text-slate-700 placeholder-slate-400 bg-white border border-[#F2C6D4] rounded-md focus:outline-none focus:border-[#D81B60] focus:ring-2 focus:ring-[#D81B60]/15 transition"
                  placeholder="••••••••"
                />
              </div>

              {loginError && (
                <div className="p-3 bg-[#FCE7EF] border border-[#F2C6D4] text-[#B81450] text-sm rounded-md">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-3 w-36 py-2.5 bg-[#D81B60] hover:bg-[#B81450] disabled:opacity-70 text-white text-xs font-semibold rounded-md shadow-sm transition cursor-pointer"
              >
                {loading ? "Validando..." : "Login"}
              </button>
            </form>
          </div>

          <div className="bg-[#FDF7F8] flex items-center justify-center p-10 border-t md:border-t-0 md:border-l border-[#F9E8EE]">
            <img
              src={logoLiga}
              alt="Fundación La Liga Ama Salvar Vidas - 50 años"
              className="max-w-[270px] w-full h-auto object-contain"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDF7F9] text-slate-800 flex flex-col">
      {loading && loadingMsg && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl px-8 py-6 max-w-md text-center border border-[#F2C6D4]">
            <div className="w-10 h-10 border-4 border-[#D81B60] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm font-semibold text-slate-800">{loadingMsg}</p>
            <p className="text-xs text-slate-500 mt-2">No cierre esta ventana hasta finalizar.</p>
          </div>
        </div>
      )}

      <header className="bg-[#1B2A59] text-white border-b-4 border-[#D81B60] px-6 py-3 flex flex-wrap items-center justify-between gap-4 shadow">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <div className="bg-white px-2.5 py-1 rounded-md shadow-sm shrink-0">
            <img src={logoLiga} alt="Logo" className="h-6 w-auto object-contain" />
          </div>
          <h1 className="text-lg font-bold tracking-tight shrink-0 hidden sm:block">Liga · PGP</h1>

          <select
            value={nota?.id_nota || ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v) cargarDetalleNota(Number(v));
            }}
            className="bg-[#131F44] text-white text-sm px-3 py-1.5 rounded border border-white/20 outline-none max-w-[280px] min-w-[200px]"
          >
            <option value="" disabled>
              -- Selecciona o importa una Nota Técnica --
            </option>
            {notasList.map((n) => (
              <option key={n.id_nota} value={n.id_nota}>
                {n.consecutivo} - {n.contratante} ({n.especialidad})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleNuevaPestana}
            className="bg-white/15 hover:bg-white/25 text-white border border-white/25 text-xs font-semibold px-3 py-2 rounded transition cursor-pointer shrink-0"
          >
            + Nueva Pestaña
          </button>

          <label
            className={
              importBloqueado
                ? "text-white text-xs font-semibold px-3 py-2 rounded transition opacity-45 cursor-not-allowed pointer-events-none bg-emerald-700/60 shrink-0"
                : "bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded cursor-pointer transition shrink-0"
            }
            title={
              importBloqueado
                ? "Ya tienes una Nota Técnica activa. Haz clic en '+ Nueva Pestaña' para habilitar la importación de otro Excel."
                : undefined
            }
          >
            Importar Excel (.xlsx)
            <input
              type="file"
              accept=".xlsx"
              onChange={handleImportExcel}
              disabled={importBloqueado}
              className="hidden"
            />
          </label>

          {nota && (
            <button
              type="button"
              onClick={handleSaveChanges}
              disabled={guardando}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold px-3 py-2 rounded transition cursor-pointer shrink-0"
            >
              {guardando ? "Guardando..." : "Guardar Cambios"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className="text-xs text-white/85 flex items-center gap-1.5 flex-wrap">
            <span>{user?.nombre}</span>
            {user?.rol && (
              <span className="px-2 py-0.5 rounded bg-white/15 text-[10px] font-semibold uppercase tracking-wide">
                {user.rol}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs bg-red-600/80 hover:bg-red-600 px-2.5 py-1.5 rounded cursor-pointer"
          >
            Salir
          </button>
        </div>
      </header>

      {!nota || !calculos ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="max-w-lg w-full bg-white border border-[#F2C6D4] rounded-2xl shadow-sm p-8 space-y-4">
            <p className="text-[#1B2A59] text-sm leading-relaxed">
              Listo para cargar una nueva Nota Técnica. Usa el botón &quot;Importar Excel (.xlsx)&quot; en la barra
              superior o selecciona una nota existente en el listado.
            </p>
            {!importBloqueado && (
              <label className="inline-block bg-[#D81B60] hover:bg-[#B81450] text-white text-xs font-semibold px-4 py-2.5 rounded-md cursor-pointer transition shadow-sm">
                Seleccionar archivo Excel (.xlsx)
                <input type="file" accept=".xlsx" onChange={handleImportExcel} className="hidden" />
              </label>
            )}
            {loading && !nota && (
              <p className="text-sm text-slate-500">Cargando...</p>
            )}
          </div>
        </div>
      ) : (
        <main className="p-4 space-y-4 max-w-[1600px] w-full mx-auto">
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-white p-4 rounded-lg shadow-sm border border-slate-200">
            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="font-bold text-slate-500 block">CONTRATANTE:</span>
                <span className="font-semibold text-slate-900">{nota.contratante}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500 block">CONTRATISTA:</span>
                <span className="font-semibold text-slate-900">{nota.contratista}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500 block">NIT DEL PRESTADOR:</span>
                <span className="font-semibold text-slate-900">{nota.nit_prestador}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500 block">REGIONAL / DEPARTAMENTO:</span>
                <span>
                  {nota.regional} - {nota.departamento}
                </span>
              </div>
              <div>
                <span className="font-bold text-slate-500 block">MUNICIPIOS DE COBERTURA:</span>
                <span>{nota.municipios}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500 block">CONSECUTIVO / VIGENCIA:</span>
                <span className="font-semibold">
                  {nota.consecutivo} ({nota.vigencia})
                </span>
              </div>
              <div>
                <span className="font-bold text-slate-500 block">ESPECIALIDAD:</span>
                <span className="font-bold text-[#D81B60]">{nota.especialidad}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500 block">ÁMBITO / GRUPO ETAREO:</span>
                <span>
                  {nota.ambito} ({nota.grupo_etareo})
                </span>
              </div>
              <div>
                <span className="font-bold text-slate-500 block">RÉGIMEN:</span>
                <span>{nota.regimen}</span>
              </div>
            </div>

            <div className="lg:col-span-5 border border-[#F2C6D4] rounded overflow-hidden">
              <div className="bg-[#FCE7EF] text-[#D81B60] text-center font-bold text-xs py-1 border-b border-[#F2C6D4]">
                NOTA TECNICA
              </div>
              <div className="grid grid-cols-3 bg-[#1B2A59] text-white text-xs font-bold text-center">
                <div className="py-1.5 border-r border-white/20">POBLACION</div>
                <div className="py-1.5 border-r border-white/20">VALOR TOTAL DEL MES</div>
                <div className="py-1.5">CXU</div>
              </div>
              <div className="grid grid-cols-3 bg-white text-sm font-bold text-center border-b border-[#F2C6D4]">
                <div className="py-2 border-r border-[#F2C6D4] px-2">
                  <input
                    type="number"
                    value={nota.poblacion}
                    onChange={(e) =>
                      setNota({ ...nota, poblacion: parseInt(e.target.value || "0", 10) })
                    }
                    className="w-full text-center font-bold bg-[#FDF2F6] border border-[#F2C6D4] text-[#1B2A59] rounded px-1 py-0.5 focus:outline-none focus:border-[#D81B60]"
                  />
                </div>
                <div className="py-2 border-r border-slate-300 text-slate-900">
                  {formatCOP(calculos.valorTotalMesGlobal)}
                </div>
                <div className="py-2 text-slate-900">{formatCOP(calculos.cxuGlobal)}</div>
              </div>
              <div className="text-xs divide-y divide-slate-200 bg-slate-50">
                <div className="grid grid-cols-3 px-3 py-1">
                  <span className="font-semibold">CONTRIBUTIVO</span>
                  <span className="text-right font-mono">{formatCOP(calculos.valorContributivo)}</span>
                  <span className="text-right font-bold">
                    {Math.round((nota.pct_contributivo || 0.78) * 100)}%
                  </span>
                </div>
                <div className="grid grid-cols-3 px-3 py-1">
                  <span className="font-semibold">SUBSIDIADO</span>
                  <span className="text-right font-mono">{formatCOP(calculos.valorSubsidiado)}</span>
                  <span className="text-right font-bold">
                    {Math.round((nota.pct_subsidiado || 0.22) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-wrap gap-2 bg-white border border-[#F2C6D4] rounded-lg px-4 py-3 shadow-sm">
            <button
              type="button"
              onClick={() => setVistaActiva("NOTA_TECNICA")}
              className={
                vistaActiva === "NOTA_TECNICA"
                  ? "text-xs font-semibold px-4 py-2 rounded-lg bg-[#D81B60] text-white cursor-pointer"
                  : "text-xs font-semibold px-4 py-2 rounded-lg bg-[#FCE7EF] text-[#1B2A59] border border-[#F2C6D4] hover:bg-[#FDF7F9] cursor-pointer"
              }
            >
              Nota Técnica (CUPS y Tarifas)
            </button>
            <button
              type="button"
              onClick={() => setVistaActiva("PACIENTES_PGP")}
              className={
                vistaActiva === "PACIENTES_PGP"
                  ? "text-xs font-semibold px-4 py-2 rounded-lg bg-[#D81B60] text-white cursor-pointer"
                  : "text-xs font-semibold px-4 py-2 rounded-lg bg-[#FCE7EF] text-[#1B2A59] border border-[#F2C6D4] hover:bg-[#FDF7F9] cursor-pointer"
              }
            >
              Ver Datos / Pacientes PGP · {nota.contratante}
            </button>
          </section>

          {vistaActiva === "PACIENTES_PGP" && renderVistaPacientesPgp()}

          {vistaActiva === "NOTA_TECNICA" && (
          <>
          <section className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-2.5 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 mr-1">ESQUEMA EXCEL:</span>
              <button
                type="button"
                onClick={() => expandirTodos(false)}
                title="Nivel 1: Contraer todo (Solo Agrupadores)"
                className="w-7 h-7 flex items-center justify-center text-xs font-bold border border-slate-400 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                1
              </button>
              <button
                type="button"
                onClick={() => expandirTodos(true)}
                title="Nivel 2: Expandir todos los CUPS"
                className="w-7 h-7 flex items-center justify-center text-xs font-bold border border-slate-400 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                2
              </button>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="text"
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                placeholder="Buscar por Agrupador, CUPS o Descripción..."
                className="text-xs px-3 py-1.5 border border-[#F2C6D4] rounded-md w-72 focus:ring-2 focus:ring-[#D81B60]/20 focus:border-[#D81B60] outline-none"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soloConFrecuencia}
                  onChange={(e) => setSoloConFrecuencia(e.target.checked)}
                />
                Solo CUPS con frecuencia &gt; 0
              </label>
              <select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
                className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-md bg-white text-slate-700 font-medium outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="TODOS">Todos los registros</option>
                <option value="COTIZACIONES">Estado: Cotizaciones (Nuevos)</option>
                <option value="OK">Estado: OK (Aprobados)</option>
                <option value="NUEVOS">Todos los nuevos (Cotizaciones + OK)</option>
              </select>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs min-w-[1400px]">
                <thead className="bg-[#F8E5EC] text-[#1B2A59] sticky top-0 z-20 shadow-sm">
                  <tr>
                    <th className="sticky left-0 z-30 bg-[#F8E5EC] border border-[#F2C6D4] w-10 px-2 py-2.5 text-center">
                      +/-
                    </th>
                    <th className="sticky left-10 z-30 bg-[#F8E5EC] border border-[#F2C6D4] min-w-[260px] px-3 py-2.5 text-left">
                      Agrupador
                    </th>
                    <th className="border border-slate-300 min-w-[95px] px-2 py-2.5 text-center">Cups</th>
                    <th className="border border-slate-300 min-w-[320px] px-3 py-2.5 text-left">
                      Descripción
                    </th>
                    <th className="border border-[#F2C6D4] min-w-[130px] px-2 py-2.5 text-right bg-[#FCE7EF]/80">
                      Frecuencia anual
                    </th>
                    <th className="border border-slate-300 min-w-[110px] px-2 py-2.5 text-right">
                      Eventos año
                    </th>
                    <th className="border border-slate-300 min-w-[110px] px-2 py-2.5 text-right">
                      Evento mes
                    </th>
                    <th className="border border-slate-300 min-w-[145px] px-2 py-2.5 text-right">
                      Costo medio evento
                    </th>
                    <th className="border border-slate-300 min-w-[155px] px-2 py-2.5 text-right">
                      Costo total
                    </th>
                    <th className="border border-slate-300 min-w-[105px] px-2 py-2.5 text-right">CxU</th>
                    <th className="border border-slate-300 min-w-[230px] px-3 py-2.5 text-left">
                      Agrupador
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {calculos.agrupadores.map((agr) => {
                    const query = filtroTexto.trim().toLowerCase();
                    const detallesFiltrados = agr.detalles.filter((d) => {
                      if (soloConFrecuencia && d.frecuencia_anual <= 0) return false;
                      if (
                        filtroEstado === "COTIZACIONES" &&
                        !(
                          d.estado_contratacion === "COTIZACIONES" ||
                          d.estado_contratacion === "CONTRATACION"
                        )
                      ) {
                        return false;
                      }
                      if (filtroEstado === "OK" && d.estado_contratacion !== "OK") return false;
                      if (filtroEstado === "NUEVOS" && !d.estado_contratacion) return false;
                      if (!query) return true;
                      return (
                        agr.nombre_agrupador.toLowerCase().includes(query) ||
                        String(d.codigo_cups).toLowerCase().includes(query) ||
                        String(d.descripcion).toLowerCase().includes(query)
                      );
                    });

                    const hayFiltroActivo = query.length > 0 || filtroEstado !== "TODOS";
                    if (
                      hayFiltroActivo &&
                      detallesFiltrados.length === 0 &&
                      !(query && agr.nombre_agrupador.toLowerCase().includes(query))
                    ) {
                      return null;
                    }

                    const isExpanded =
                      !!expandedGroups[agr.id_agrupador] || query.length > 0 || filtroEstado !== "TODOS";

                    return (
                      <React.Fragment key={agr.id_agrupador}>
                        <tr className="bg-[#F4EDF2] font-bold text-[#1B2A59] hover:bg-[#FCE7EF]/70">
                          <td className="sticky left-0 z-10 bg-[#F4EDF2] border border-[#F2C6D4] text-center py-1.5">
                            <button
                              type="button"
                              onClick={() => toggleAgrupador(agr.id_agrupador)}
                              className="w-5 h-5 inline-flex items-center justify-center border border-slate-500 bg-white hover:bg-slate-200 text-slate-800 font-bold text-xs rounded cursor-pointer"
                            >
                              {isExpanded ? "−" : "+"}
                            </button>
                          </td>
                          <td className="sticky left-10 z-10 bg-[#F4EDF2] border border-[#F2C6D4] px-3 py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                onClick={() => toggleAgrupador(agr.id_agrupador)}
                                className="cursor-pointer"
                                role="presentation"
                              >
                                {agr.nombre_agrupador}{" "}
                                <span className="text-[10px] font-normal text-slate-500">
                                  ({agr.detalles.length})
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setModalCupsAgrId(agr.id_agrupador)}
                                title="Agregar CUPS a este agrupador"
                                className="text-[10px] px-1.5 py-0.5 bg-[#D81B60] text-white rounded hover:bg-[#B81450] cursor-pointer"
                              >
                                + CUPS
                              </button>
                            </div>
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5" />
                          <td className="border border-slate-300 px-3 py-1.5" />
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                            {formatNum(agr.totales.frecuencia_anual, 4)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                            {formatNum(agr.totales.eventosAnio, 0)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                            {formatNum(agr.totales.eventosMes, 2)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                            {formatCOP(agr.totales.costo_medio_evento)}
                          </td>
                          <td className="border border-[#F2C6D4] px-2 py-1.5 text-right font-mono text-[#1B2A59]">
                            {formatCOP(agr.totales.costoTotal)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                            {formatCOP(agr.totales.cxu)}
                          </td>
                          <td className="border border-slate-300 px-3 py-1.5">{agr.nombre_agrupador}</td>
                        </tr>

                        {isExpanded &&
                          detallesFiltrados.map((det) => (
                            <tr
                              key={det.id_detalle}
                              className="bg-white hover:bg-amber-50/40 text-slate-700"
                            >
                              <td className="sticky left-0 z-10 bg-slate-50 border border-slate-200 text-center text-slate-300">
                                •
                              </td>
                              <td className="sticky left-10 z-10 bg-white border border-slate-200 px-3 py-1 text-slate-500 truncate max-w-[260px]">
                                {agr.nombre_agrupador}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-center font-mono font-semibold text-slate-900">
                                {det.estado_contratacion ? (
                                  <input
                                    type="text"
                                    value={det.codigo_cups}
                                    onChange={(e) =>
                                      handleCellChange(
                                        agr.id_agrupador,
                                        det.id_detalle,
                                        "codigo_cups",
                                        e.target.value
                                      )
                                    }
                                    className="w-24 text-center font-mono px-1.5 py-0.5 border border-purple-200 rounded bg-purple-50/40 focus:border-purple-500 outline-none"
                                  />
                                ) : (
                                  det.codigo_cups
                                )}
                              </td>
                              <td className="border border-slate-200 px-3 py-1">
                                {det.estado_contratacion ? (
                                  <div className="flex items-center justify-between gap-2 min-w-[280px]">
                                    <input
                                      type="text"
                                      value={det.descripcion}
                                      onChange={(e) =>
                                        handleCellChange(
                                          agr.id_agrupador,
                                          det.id_detalle,
                                          "descripcion",
                                          e.target.value.toUpperCase()
                                        )
                                      }
                                      className="flex-1 min-w-0 text-xs px-1.5 py-0.5 border border-purple-200 rounded bg-purple-50/30 focus:border-purple-500 outline-none uppercase"
                                    />
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleToggleEstado(
                                            agr.id_agrupador,
                                            det.id_detalle,
                                            det.estado_contratacion
                                          )
                                        }
                                        className={
                                          esEstadoCotizaciones(det.estado_contratacion)
                                            ? "text-[10px] font-bold px-2 py-0.5 rounded border border-purple-300 bg-purple-100 text-purple-800 hover:bg-purple-200 cursor-pointer whitespace-nowrap"
                                            : "text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 cursor-pointer whitespace-nowrap"
                                        }
                                      >
                                        {esEstadoCotizaciones(det.estado_contratacion) ? "Cotizaciones" : "OK ✓"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setModalObs({
                                            idAgrupador: agr.id_agrupador,
                                            nombreAgrupador: agr.nombre_agrupador,
                                            det,
                                            textoObs: det.observacion || "",
                                            guardando: false,
                                          })
                                        }
                                        title={
                                          det.observacion
                                            ? `Observación: ${det.observacion}`
                                            : "Agregar o editar observación"
                                        }
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
                                          det.observacion && det.observacion.trim()
                                            ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                                            : "bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100"
                                        }`}
                                      >
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          viewBox="0 0 20 20"
                                          fill="currentColor"
                                          className="w-3.5 h-3.5"
                                        >
                                          <path
                                            fillRule="evenodd"
                                            d="M3.43 2.524A41.29 41.29 0 0110 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.102 41.102 0 01-3.55.414c-.28.02-.521.18-.643.413l-1.712 3.293a.75.75 0 01-1.33 0l-1.713-3.293a.783.783 0 00-.642-.413 41.108 41.108 0 01-3.55-.414C1.993 13.245 1 11.986 1 10.574V5.426c0-1.413.993-2.67 2.43-2.902z"
                                            clipRule="evenodd"
                                          />
                                        </svg>
                                        <span>Obs.</span>
                                        {det.observacion && det.observacion.trim() && (
                                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleEliminarCupsNuevo(agr.id_agrupador, det)}
                                        title="Eliminar este CUPS nuevo"
                                        className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded border border-transparent hover:border-rose-200 transition cursor-pointer"
                                      >
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          viewBox="0 0 20 20"
                                          fill="currentColor"
                                          className="w-4 h-4"
                                        >
                                          <path
                                            fillRule="evenodd"
                                            d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                                            clipRule="evenodd"
                                          />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  det.descripcion
                                )}
                              </td>
                              <td className="border border-slate-200 px-1.5 py-1 text-right bg-[#FDF2F6]/50">
                                <input
                                  type="number"
                                  step="0.0001"
                                  value={det.frecuencia_anual}
                                  onChange={(e) =>
                                    handleCellChange(
                                      agr.id_agrupador,
                                      det.id_detalle,
                                      "frecuencia_anual",
                                      e.target.value
                                    )
                                  }
                                  className="w-28 text-right font-mono px-1.5 py-0.5 border border-[#F2C6D4] rounded bg-[#FDF2F6]/60 focus:border-[#D81B60] outline-none"
                                />
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-right font-mono">
                                {formatNum(det.eventosAnio, 0)}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-right font-mono">
                                {formatNum(det.eventoMes, 2)}
                              </td>
                              <td className="border border-slate-200 px-1.5 py-1 text-right">
                                <input
                                  type="number"
                                  step="1"
                                  value={Math.round(det.costo_medio_evento)}
                                  onChange={(e) =>
                                    handleCellChange(
                                      agr.id_agrupador,
                                      det.id_detalle,
                                      "costo_medio_evento",
                                      e.target.value
                                    )
                                  }
                                  className="w-32 text-right font-mono px-1.5 py-0.5 border border-slate-200 rounded bg-slate-50 focus:bg-white focus:border-blue-600 outline-none"
                                />
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-right font-mono font-medium text-slate-900">
                                {formatCOP(det.costoTotal)}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-right font-mono">
                                {formatCOP(det.cxu)}
                              </td>
                              <td className="border border-slate-200 px-3 py-1 text-slate-500">
                                {agr.nombre_agrupador}
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          </>
          )}
        </main>
      )}

      {modalObs && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleGuardarObservacion}
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="bg-[#1B2A59] text-white px-6 py-4 flex items-center justify-between border-b-4 border-[#D81B60] rounded-t-xl">
              <h2 className="text-sm font-bold tracking-tight">Detalle y Observación del CUPS Nuevo</h2>
              <button
                type="button"
                onClick={() => setModalObs(null)}
                className="text-white/80 hover:text-white text-xl leading-none px-2 cursor-pointer"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              <div className="bg-[#FDF7F9] border border-[#F2C6D4] rounded-lg p-4 mb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-700">
                  <div>
                    <span className="font-bold text-[#1B2A59]">Agrupador:</span> {modalObs.nombreAgrupador}
                  </div>
                  <div>
                    <span className="font-bold text-[#1B2A59]">Estado:</span>{" "}
                    {esEstadoCotizaciones(modalObs.det.estado_contratacion) ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-purple-300 bg-purple-100 text-purple-800">
                        Cotizaciones
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-300 bg-emerald-100 text-emerald-800">
                        OK ✓
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="font-bold text-[#1B2A59]">Código CUPS:</span> {modalObs.det.codigo_cups}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-bold text-[#1B2A59]">Descripción:</span> {modalObs.det.descripcion}
                  </div>
                  <div>
                    <span className="font-bold text-[#1B2A59]">Frecuencia Anual:</span>{" "}
                    {Number(modalObs.det.frecuencia_anual || 0).toFixed(6)}
                  </div>
                  <div>
                    <span className="font-bold text-[#1B2A59]">Eventos Año:</span>{" "}
                    {Math.round(
                      (Number(modalObs.det.frecuencia_anual) || 0) * (Number(nota?.poblacion) || 0)
                    ).toLocaleString("es-CO")}
                  </div>
                  <div>
                    <span className="font-bold text-[#1B2A59]">Evento Mes:</span>{" "}
                    {(
                      ((Number(modalObs.det.frecuencia_anual) || 0) * (Number(nota?.poblacion) || 0)) /
                      12
                    ).toFixed(2)}
                  </div>
                  <div>
                    <span className="font-bold text-[#1B2A59]">Costo Medio Evento:</span>{" "}
                    $ {Math.round(Number(modalObs.det.costo_medio_evento) || 0).toLocaleString("es-CO")}
                  </div>
                  <div>
                    <span className="font-bold text-[#1B2A59]">Costo Total:</span>{" "}
                    $ {Math.round(
                      (((Number(modalObs.det.frecuencia_anual) || 0) * (Number(nota?.poblacion) || 0)) / 12) *
                        (Number(modalObs.det.costo_medio_evento) || 0)
                    ).toLocaleString("es-CO")}
                  </div>
                  <div>
                    <span className="font-bold text-[#1B2A59]">CxU:</span>{" "}
                    $ {Math.round(
                      ((((Number(modalObs.det.frecuencia_anual) || 0) * (Number(nota?.poblacion) || 0)) / 12) *
                        (Number(modalObs.det.costo_medio_evento) || 0)) /
                        (Number(nota?.poblacion) || 1)
                    ).toLocaleString("es-CO")}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#1B2A59]">Observación</label>
                  <span className="text-[11px] text-slate-500">
                    {modalObs.textoObs.length} / 4000 caracteres
                  </span>
                </div>
                <textarea
                  rows={5}
                  maxLength={4000}
                  value={modalObs.textoObs}
                  onChange={(e) =>
                    setModalObs((prev) => (prev ? { ...prev, textoObs: e.target.value } : null))
                  }
                  placeholder="Ingresa aquí la observación detallada, justificación clínica o notas de cotización..."
                  className="w-full px-3.5 py-2.5 text-sm text-slate-800 border border-[#F2C6D4] rounded-lg focus:outline-none focus:border-[#D81B60] focus:ring-2 focus:ring-[#D81B60]/15 resize-y"
                />
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setModalObs(null)}
                  className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={modalObs.guardando}
                  className="px-4 py-2 text-xs font-semibold bg-[#D81B60] hover:bg-[#B81450] disabled:opacity-60 text-white rounded-md cursor-pointer"
                >
                  {modalObs.guardando ? "Guardando..." : "Guardar Observación"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {modalCupsAgrId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleAgregarCupsSubmit}
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
          >
            <h2 className="text-base font-bold text-slate-800">Agregar Procedimiento CUPS</h2>
            <div>
              <label className="block text-xs font-bold mb-1">Código CUPS</label>
              <input
                type="text"
                required
                value={nuevoCups.codigo_cups}
                onChange={(e) => setNuevoCups({ ...nuevoCups, codigo_cups: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Descripción</label>
              <input
                type="text"
                required
                value={nuevoCups.descripcion}
                onChange={(e) => setNuevoCups({ ...nuevoCups, descripcion: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1">Frecuencia Anual</label>
                <input
                  type="number"
                  step="0.0001"
                  value={nuevoCups.frecuencia_anual}
                  onChange={(e) => setNuevoCups({ ...nuevoCups, frecuencia_anual: e.target.value })}
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">Costo Medio Evento</label>
                <input
                  type="number"
                  step="1"
                  value={nuevoCups.costo_medio_evento}
                  onChange={(e) =>
                    setNuevoCups({ ...nuevoCups, costo_medio_evento: e.target.value })
                  }
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1 text-[#1B2A59]">Observación inicial (opcional)</label>
              <textarea
                rows={3}
                maxLength={4000}
                value={nuevoCups.observacion}
                onChange={(e) => setNuevoCups({ ...nuevoCups, observacion: e.target.value })}
                placeholder="Observación inicial (opcional)..."
                className="w-full border border-[#F2C6D4] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#D81B60] focus:ring-2 focus:ring-[#D81B60]/15 resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalCupsAgrId(null)}
                className="px-4 py-1.5 text-xs font-semibold border border-slate-300 rounded cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold bg-[#D81B60] hover:bg-[#B81450] text-white rounded cursor-pointer"
              >
                Guardar CUPS
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}