import { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  orderBy,
} from "firebase/firestore";

// ─── UTILS ───────────────────────────────────────────────────────────────────
function formatData(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.includes("T") ? "" : "T00:00:00"));
  return d.toLocaleDateString("pt-BR");
}

function gerarMensagem(r) {
  let msg = `Aula ${r.numeroAula} – ${r.titulo}\nTurma: ${r.turma}\n\nObjetivos da aula:\n`;
  r.objetivos.forEach(o => { msg += `• ${o}\n`; });
  msg += `\n${r.textoIA}\n`;
  if (r.tarefa) msg += `\nTarefa:\n${r.tarefa}\n`;
  if (r.anexo)  msg += `\nAnexo:\n${r.anexo}\n`;
  msg += `\nAtenciosamente,\n${r.equipe}`;
  return msg;
}

// ─── AI SERVICE ──────────────────────────────────────────────────────────────
async function gerarTextoIA({ numeroAula, titulo, turma, objetivos, tarefa }) {
  const prompt = `Você é um professor de tecnologia. Escreva exatamente 2 parágrafos curtos (máximo 2 frases cada) para o relatório desta aula. Linguagem formal e pedagógica. SEM introduções, saudações ou conclusões. Apenas os 2 parágrafos.

Aula ${numeroAula} – ${titulo} | Turma: ${turma}
Objetivos: ${objetivos.join("; ")}${tarefa ? ` | Tarefa: ${tarefa}` : ""}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Texto não gerado.";
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
function Toast({ toasts, remove }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10 }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} style={{
          background: t.type === "error" ? "#ef4444" : t.type === "success" ? "#22c55e" : "#3b82f6",
          color: "#fff", padding: "12px 20px", borderRadius: 10, fontSize: 14,
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)", cursor: "pointer", maxWidth: 320,
          animation: "slideIn .3s ease",
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = (msg, type = "success") => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  };
  const remove = id => setToasts(p => p.filter(t => t.id !== id));
  return { toasts, add, remove };
}

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
function Card({ dark, children, style = {} }) {
  return (
    <div style={{ background: dark ? "#1e293b" : "#fff", borderRadius: 14, padding: 24, border: `1px solid ${dark ? "#334155" : "#e5e7eb"}`, ...style }}>
      {children}
    </div>
  );
}

function Btn({ onClick, children, color = "#25D366", textColor = "#fff", outline = false, small = false, disabled = false, style = {} }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: outline ? "transparent" : (disabled ? "#94a3b8" : color),
      color: outline ? color : textColor,
      border: outline ? `1.5px solid ${color}` : "none",
      padding: small ? "7px 14px" : "11px 22px",
      borderRadius: 9, fontSize: small ? 13 : 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
      transition: "all .15s", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap", ...style
    }}>{children}</button>
  );
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
function Sidebar({ page, setPage, dark, setDark, user, mobile, open, setOpen, onLogout }) {
  const items = [
    { id: "dashboard", icon: "⊞", label: "Dashboard" },
    { id: "gerar",     icon: "✦", label: "Gerar Relatório" },
    { id: "historico", icon: "◎", label: "Histórico" },
    { id: "config",    icon: "⚙", label: "Configurações" },
  ];

  const bg       = dark ? "#0f172a" : "#fff";
  const border   = dark ? "#1e293b" : "#e5e7eb";
  const text     = dark ? "#e2e8f0" : "#1e293b";
  const sub      = dark ? "#64748b" : "#94a3b8";
  const active   = dark ? "#dcfce7" : "#166534";
  const activeBg = dark ? "#14532d" : "#dcfce7";

  const displayName = user.displayName || user.email?.split("@")[0] || "Usuário";
  const avatar      = user.photoURL ? (
    <img src={user.photoURL} alt="" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
  ) : (
    <div style={{ width: 34, height: 34, background: "#25D366", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
      {displayName[0].toUpperCase()}
    </div>
  );

  const content = (
    <div style={{ width: mobile ? "80vw" : 240, maxWidth: 280, background: bg, borderRight: `1px solid ${border}`, height: "100vh", display: "flex", flexDirection: "column", padding: "0 0 24px" }}>
      <div style={{ padding: "28px 24px 20px", borderBottom: `1px solid ${border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: "#25D366", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📋</div>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16, color: text, letterSpacing: -0.5 }}>ClassReport</div>
            <div style={{ fontSize: 11, color: sub }}>by Ctrl+Play</div>
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map(it => (
          <button key={it.id} onClick={() => { setPage(it.id); if (mobile) setOpen(false); }}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", textAlign: "left", width: "100%", background: page === it.id ? activeBg : "transparent", color: page === it.id ? active : text, fontWeight: page === it.id ? 700 : 500, fontSize: 14, transition: "all .15s" }}>
            <span style={{ fontSize: 16, opacity: 0.8 }}>{it.icon}</span>
            {it.label}
          </button>
        ))}
      </nav>

      <div style={{ padding: "0 16px" }}>
        <div style={{ borderTop: `1px solid ${border}`, paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            {avatar}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
              <div style={{ fontSize: 11, color: sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
            </div>
            <button onClick={() => setDark(!dark)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: 4, flexShrink: 0 }} title="Dark mode">
              {dark ? "☀️" : "🌙"}
            </button>
          </div>
          <button onClick={onLogout} style={{ width: "100%", padding: "9px 14px", borderRadius: 9, border: `1.5px solid ${dark ? "#334155" : "#e2e8f0"}`, background: "transparent", color: "#ef4444", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            ⏻ Sair
          </button>
        </div>
      </div>
    </div>
  );

  if (!mobile) return content;
  return (
    <>
      {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99 }} />}
      <div style={{ position: "fixed", left: open ? 0 : "-100vw", top: 0, zIndex: 100, transition: "left .25s ease" }}>{content}</div>
    </>
  );
}

// ─── LOGIN / CADASTRO ────────────────────────────────────────────────────────
function AuthScreen({ dark }) {
  const [tab, setTab]         = useState("login"); // "login" | "cadastro"
  const [email, setEmail]     = useState("");
  const [senha, setSenha]     = useState("");
  const [nome, setNome]       = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState("");

  const bg          = dark ? "#0f172a" : "#f8fafc";
  const cardBg      = dark ? "#1e293b" : "#fff";
  const text        = dark ? "#e2e8f0" : "#1e293b";
  const sub         = dark ? "#94a3b8" : "#64748b";
  const inputBg     = dark ? "#0f172a" : "#f8fafc";
  const inputBorder = dark ? "#334155" : "#e2e8f0";
  const borderColor = dark ? "#334155" : "#e5e7eb";

  const inputStyle = {
    width: "100%", padding: "12px 14px", borderRadius: 10,
    border: `1.5px solid ${inputBorder}`, background: inputBg,
    color: text, fontSize: 14, outline: "none", boxSizing: "border-box",
  };

  const mensagemErro = (code) => {
    const mapa = {
      "auth/email-already-in-use":    "Este e-mail já está cadastrado.",
      "auth/invalid-email":           "E-mail inválido.",
      "auth/weak-password":           "Senha muito fraca (mínimo 6 caracteres).",
      "auth/user-not-found":          "Usuário não encontrado.",
      "auth/wrong-password":          "Senha incorreta.",
      "auth/invalid-credential":      "E-mail ou senha incorretos.",
      "auth/popup-closed-by-user":    "Login com Google cancelado.",
      "auth/too-many-requests":       "Muitas tentativas. Tente novamente em alguns minutos.",
    };
    return mapa[code] || "Ocorreu um erro. Tente novamente.";
  };

  const handleEmailAuth = async () => {
    setErro(""); setLoading(true);
    try {
      if (tab === "cadastro") {
        if (!nome.trim()) { setErro("Digite seu nome."); setLoading(false); return; }
        const cred = await createUserWithEmailAndPassword(auth, email, senha);
        await updateProfile(cred.user, { displayName: nome.trim() });
      } else {
        await signInWithEmailAndPassword(auth, email, senha);
      }
    } catch (e) {
      setErro(mensagemErro(e.code));
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setErro(""); setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      setErro(mensagemErro(e.code));
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 60, height: 60, background: "#25D366", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 16px" }}>📋</div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 28, color: text, margin: "0 0 6px", letterSpacing: -1 }}>ClassReport</h1>
          <p style={{ color: sub, margin: 0, fontSize: 14 }}>Sistema de Relatórios de Aulas</p>
        </div>

        <div style={{ background: cardBg, borderRadius: 16, padding: 28, border: `1px solid ${borderColor}` }}>
          {/* Tabs */}
          <div style={{ display: "flex", background: dark ? "#0f172a" : "#f1f5f9", borderRadius: 10, padding: 4, marginBottom: 24 }}>
            {["login", "cadastro"].map(t => (
              <button key={t} onClick={() => { setTab(t); setErro(""); }}
                style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all .15s",
                  background: tab === t ? (dark ? "#1e293b" : "#fff") : "transparent",
                  color: tab === t ? text : sub,
                  boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                }}>
                {t === "login" ? "Entrar" : "Criar Conta"}
              </button>
            ))}
          </div>

          {/* Google */}
          <button onClick={handleGoogle} disabled={loading} style={{ width: "100%", padding: "12px", background: dark ? "#0f172a" : "#f8fafc", color: text, border: `1.5px solid ${inputBorder}`, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 20, opacity: loading ? 0.6 : 1 }}>
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continuar com Google
          </button>

          {/* Divisor */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: borderColor }} />
            <span style={{ fontSize: 12, color: sub }}>ou</span>
            <div style={{ flex: 1, height: 1, background: borderColor }} />
          </div>

          {/* Formulário */}
          {tab === "cadastro" && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: sub, display: "block", marginBottom: 6 }}>Nome completo</label>
              <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" />
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: sub, display: "block", marginBottom: 6 }}>E-mail</label>
            <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" type="email" />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: sub, display: "block", marginBottom: 6 }}>Senha{tab === "cadastro" ? " (mín. 6 caracteres)" : ""}</label>
            <input type="password" style={inputStyle} value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••"
              onKeyDown={e => e.key === "Enter" && handleEmailAuth()} />
          </div>

          {erro && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
              {erro}
            </div>
          )}

          <button onClick={handleEmailAuth} disabled={loading} style={{ width: "100%", padding: "13px", background: "#25D366", color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "⏳ Aguarde..." : tab === "login" ? "Entrar" : "Criar Conta"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ dark, reports, setPage }) {
  const text = dark ? "#e2e8f0" : "#1e293b";
  const sub  = dark ? "#94a3b8" : "#64748b";
  const now  = new Date();
  const thisMonth = reports.filter(r => {
    const d = new Date(r.criadoEm);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const turmasUnicas = [...new Set(reports.map(r => r.turma))].length;

  const stats = [
    { icon: "📊", label: "Relatórios Gerados", value: reports.length, color: "#3b82f6" },
    { icon: "👥", label: "Turmas Utilizadas",   value: turmasUnicas,  color: "#8b5cf6" },
    { icon: "📅", label: "Este Mês",            value: thisMonth,     color: "#25D366" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: text, margin: 0, letterSpacing: -0.5 }}>Dashboard</h1>
        <p style={{ color: sub, margin: "4px 0 0", fontSize: 14 }}>Bem-vindo de volta!</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16, marginBottom: 28 }}>
        {stats.map((s, i) => (
          <Card dark={dark} key={i}>
            <div style={{ fontSize: 26, marginBottom: 10 }}>{s.icon}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: s.color, fontFamily: "'Syne',sans-serif" }}>{s.value}</div>
            <div style={{ fontSize: 13, color: sub, marginTop: 4 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      <Card dark={dark} style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: text }}>Últimos Relatórios</h2>
          <Btn onClick={() => setPage("historico")} color="#25D366" small>Ver todos</Btn>
        </div>
        {reports.slice(-3).reverse().map(r => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${dark ? "#334155" : "#f1f5f9"}` }}>
            <div style={{ width: 40, height: 40, background: dark ? "#0f172a" : "#f0fdf4", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📝</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Aula {r.numeroAula} – {r.titulo}</div>
              <div style={{ fontSize: 12, color: sub }}>Turma {r.turma} · {formatData(r.data)}</div>
            </div>
          </div>
        ))}
        {reports.length === 0 && <div style={{ color: sub, fontSize: 14, textAlign: "center", padding: "20px 0" }}>Nenhum relatório ainda. Crie o primeiro!</div>}
      </Card>

      <div style={{ textAlign: "center" }}>
        <Btn onClick={() => setPage("gerar")} color="#25D366" style={{ fontSize: 15, padding: "13px 32px" }}>
          ✦ Gerar Novo Relatório
        </Btn>
      </div>
    </div>
  );
}

// ─── GERAR RELATÓRIO ─────────────────────────────────────────────────────────
function GerarRelatorio({ dark, onSave, toast }) {
  const text        = dark ? "#e2e8f0" : "#1e293b";
  const sub         = dark ? "#94a3b8" : "#64748b";
  const inputBg     = dark ? "#0f172a" : "#f8fafc";
  const inputBorder = dark ? "#334155" : "#e2e8f0";

  const [step, setStep]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [textoIA, setTextoIA] = useState("");
  const [copied, setCopied]   = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const fileRef               = useRef(null);

  const [form, setForm] = useState({
    numeroAula: "", titulo: "", turma: "", equipe: "Equipe Ctrl+Play",
    data: new Date().toISOString().split("T")[0],
    objetivos: [""], tarefa: "",
  });

  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 9, border: `1.5px solid ${inputBorder}`, background: inputBg, color: text, fontSize: 14, outline: "none", boxSizing: "border-box" };
  const labelStyle = { fontSize: 13, fontWeight: 600, color: sub, marginBottom: 6, display: "block" };

  const setField       = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const addObjetivo    = () => setForm(p => ({ ...p, objetivos: [...p.objetivos, ""] }));
  const setObjetivo    = (i, v) => setForm(p => { const o = [...p.objetivos]; o[i] = v; return { ...p, objetivos: o }; });
  const removeObjetivo = i => setForm(p => ({ ...p, objetivos: p.objetivos.filter((_, x) => x !== i) }));

  const valid = form.numeroAula && form.titulo && form.turma.trim() && form.equipe && form.objetivos.some(o => o.trim());

  const gerar = async () => {
    if (!valid) { toast("Preencha os campos obrigatórios", "error"); return; }
    setLoading(true);
    try {
      const t = await gerarTextoIA({ ...form, objetivos: form.objetivos.filter(o => o.trim()) });
      setTextoIA(t);
      setStep(2);
    } catch (e) {
      toast(`Erro Gemini: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const nomeAnexo = arquivo ? arquivo.name : "";
  const mensagem  = gerarMensagem({ ...form, objetivos: form.objetivos.filter(o => o.trim()), textoIA, anexo: nomeAnexo });

  const copiar = () => {
    navigator.clipboard.writeText(mensagem);
    setCopied(true); toast("Mensagem copiada! ✓");
    setTimeout(() => setCopied(false), 2000);
  };

  const salvar = async () => {
    await onSave({
      ...form,
      objetivos: form.objetivos.filter(o => o.trim()),
      textoIA, anexo: nomeAnexo, criadoEm: new Date().toISOString(),
    });
    toast("Relatório salvo! ✓");
    setStep(1);
    setForm({ numeroAula: "", titulo: "", turma: "", equipe: "Equipe Ctrl+Play", data: new Date().toISOString().split("T")[0], objetivos: [""], tarefa: "" });
    setTextoIA(""); setArquivo(null);
  };

  if (step === 2) return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={() => setStep(1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: sub }}>←</button>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 24, color: text, margin: 0 }}>Prévia do Relatório</h1>
      </div>
      <Card dark={dark} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: sub }}>MENSAGEM GERADA</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={copiar} color="#25D366" small>{copied ? "✓ Copiado!" : "📋 Copiar"}</Btn>
            <Btn onClick={salvar} color="#3b82f6" small>💾 Salvar</Btn>
          </div>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, color: text, lineHeight: 1.7, margin: 0, background: dark ? "#0f172a" : "#f8fafc", padding: 20, borderRadius: 10, border: `1px solid ${inputBorder}` }}>
          {mensagem}
        </pre>
      </Card>
      <Card dark={dark}>
        <div style={{ fontSize: 13, fontWeight: 600, color: sub, marginBottom: 12 }}>EDITAR TEXTO DA IA</div>
        <textarea value={textoIA} onChange={e => setTextoIA(e.target.value)}
          style={{ ...inputStyle, minHeight: 120, resize: "vertical" }} />
      </Card>
    </div>
  );

  return (
    <div>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 24, color: text, margin: "0 0 24px", letterSpacing: -0.5 }}>Gerar Relatório</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card dark={dark}>
          <label style={labelStyle}>Nº da Aula *</label>
          <input style={inputStyle} value={form.numeroAula} onChange={e => setField("numeroAula", e.target.value)} placeholder="Ex: 11" />
        </Card>
        <Card dark={dark}>
          <label style={labelStyle}>Data</label>
          <input type="date" style={inputStyle} value={form.data} onChange={e => setField("data", e.target.value)} />
        </Card>
      </div>

      <Card dark={dark} style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Título da Aula *</label>
        <input style={inputStyle} value={form.titulo} onChange={e => setField("titulo", e.target.value)} placeholder="Ex: Autorização e Controle de Acesso com JWT" />
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card dark={dark}>
          <label style={labelStyle}>Turma *</label>
          <input style={inputStyle} value={form.turma} onChange={e => setField("turma", e.target.value)} placeholder="Ex: CY4, CT2..." />
        </Card>
        <Card dark={dark}>
          <label style={labelStyle}>Nome da Equipe</label>
          <input style={inputStyle} value={form.equipe} onChange={e => setField("equipe", e.target.value)} />
        </Card>
      </div>

      <Card dark={dark} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <label style={{ ...labelStyle, margin: 0 }}>Objetivos da Aula *</label>
          <Btn onClick={addObjetivo} color="#25D366" small>+ Adicionar</Btn>
        </div>
        {form.objetivos.map((o, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} value={o} onChange={e => setObjetivo(i, e.target.value)} placeholder={`Objetivo ${i + 1}`} />
            {form.objetivos.length > 1 && (
              <button onClick={() => removeObjetivo(i)} style={{ background: "#fee2e2", color: "#ef4444", border: "none", borderRadius: 8, padding: "0 12px", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>✕</button>
            )}
          </div>
        ))}
      </Card>

      <Card dark={dark} style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Tarefa (opcional)</label>
        <input style={inputStyle} value={form.tarefa} onChange={e => setField("tarefa", e.target.value)} placeholder="Descreva a tarefa para os alunos..." />
      </Card>

      <Card dark={dark} style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Anexo (opcional)</label>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" style={{ display: "none" }} onChange={e => setArquivo(e.target.files[0] || null)} />
        {arquivo ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 9, border: `1.5px solid #25D366`, background: dark ? "#0f172a" : "#f0fdf4" }}>
            <span style={{ fontSize: 20 }}>{arquivo.name.endsWith(".pdf") ? "📄" : arquivo.name.match(/\.(png|jpg|jpeg)$/i) ? "🖼️" : "📎"}</span>
            <span style={{ flex: 1, fontSize: 14, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{arquivo.name}</span>
            <span style={{ fontSize: 12, color: sub, flexShrink: 0 }}>{(arquivo.size / 1024).toFixed(0)} KB</span>
            <button onClick={() => { setArquivo(null); fileRef.current.value = ""; }} style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", fontSize: 18, padding: "0 4px", flexShrink: 0 }}>✕</button>
          </div>
        ) : (
          <button onClick={() => fileRef.current.click()} style={{ width: "100%", padding: "18px", borderRadius: 9, border: `1.5px dashed ${inputBorder}`, background: inputBg, color: sub, fontSize: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 24 }}>📎</span>
            <span>Clique para anexar arquivo</span>
            <span style={{ fontSize: 12 }}>PDF, DOCX, PNG, JPG</span>
          </button>
        )}
      </Card>

      <div style={{ textAlign: "center" }}>
        <Btn onClick={gerar} disabled={loading || !valid} color="#25D366" style={{ fontSize: 15, padding: "13px 36px" }}>
          {loading ? "⏳ Gerando com IA..." : "✦ Gerar Relatório com IA"}
        </Btn>
      </div>
    </div>
  );
}

// ─── HISTÓRICO ───────────────────────────────────────────────────────────────
function Historico({ dark, reports, setReports, toast }) {
  const text = dark ? "#e2e8f0" : "#1e293b";
  const sub  = dark ? "#94a3b8" : "#64748b";
  const [filtroTurma, setFiltroTurma] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [selected, setSelected]       = useState(null);
  const [copied, setCopied]           = useState(false);

  const inputStyle = { padding: "9px 14px", borderRadius: 9, border: `1.5px solid ${dark ? "#334155" : "#e2e8f0"}`, background: dark ? "#0f172a" : "#f8fafc", color: text, fontSize: 13, outline: "none" };
  const turmas     = [...new Set(reports.map(r => r.turma))];
  const filtered   = reports.filter(r =>
    (!filtroTurma || r.turma === filtroTurma) &&
    (!filtroTexto || r.titulo.toLowerCase().includes(filtroTexto.toLowerCase()))
  ).reverse();

  const copiar = (r) => {
    navigator.clipboard.writeText(gerarMensagem(r));
    setCopied(r.id); toast("Copiado!");
    setTimeout(() => setCopied(null), 2000);
  };
  const deletar = async (id) => {
    await setReports(id);
    if (selected?.id === id) setSelected(null);
    toast("Excluído");
  };
  const exportTxt = (r) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([gerarMensagem(r)], { type: "text/plain" }));
    a.download = `aula-${r.numeroAula}-${r.turma}.txt`; a.click();
    toast("Exportado como TXT ✓");
  };

  if (selected) return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: sub }}>←</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Aula {selected.numeroAula} – {selected.titulo}</h2>
      </div>
      <Card dark={dark} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <Btn onClick={() => copiar(selected)} color="#25D366" small>{copied === selected.id ? "✓ Copiado!" : "📋 Copiar"}</Btn>
          <Btn onClick={() => exportTxt(selected)} color="#3b82f6" small>⬇ TXT</Btn>
          <Btn onClick={() => deletar(selected.id)} color="#ef4444" small>🗑 Excluir</Btn>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, color: text, lineHeight: 1.7, margin: 0, background: dark ? "#0f172a" : "#f8fafc", padding: 18, borderRadius: 10, border: `1px solid ${dark ? "#334155" : "#e5e7eb"}` }}>
          {gerarMensagem(selected)}
        </pre>
      </Card>
    </div>
  );

  return (
    <div>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 24, color: text, margin: "0 0 20px", letterSpacing: -0.5 }}>Histórico</h1>
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input style={inputStyle} placeholder="🔍 Buscar por título..." value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} />
        <select style={inputStyle} value={filtroTurma} onChange={e => setFiltroTurma(e.target.value)}>
          <option value="">Todas as turmas</option>
          {turmas.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && <div style={{ color: sub, textAlign: "center", padding: "40px 0" }}>Nenhum relatório encontrado.</div>}
        {filtered.map(r => (
          <Card dark={dark} key={r.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div onClick={() => setSelected(r)} style={{ flex: 1, cursor: "pointer", minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Aula {r.numeroAula} – {r.titulo}</div>
                <div style={{ fontSize: 12, color: sub, marginTop: 3 }}>Turma {r.turma} · {formatData(r.data)}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <Btn onClick={() => copiar(r)} color="#25D366" small>{copied === r.id ? "✓" : "📋"}</Btn>
                <Btn onClick={() => exportTxt(r)} color="#3b82f6" small>⬇</Btn>
                <Btn onClick={() => deletar(r.id)} color="#ef4444" small>🗑</Btn>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── CONFIGURAÇÕES ───────────────────────────────────────────────────────────
function Configuracoes({ dark, setDark, user, toast }) {
  const text        = dark ? "#e2e8f0" : "#1e293b";
  const sub         = dark ? "#94a3b8" : "#64748b";
  const inputBg     = dark ? "#0f172a" : "#f8fafc";
  const inputBorder = dark ? "#334155" : "#e2e8f0";
  const inputStyle  = { width: "100%", padding: "10px 14px", borderRadius: 9, border: `1.5px solid ${inputBorder}`, background: inputBg, color: text, fontSize: 14, outline: "none", boxSizing: "border-box" };

  const [nome, setNome] = useState(user.displayName || "");

  const salvarNome = async () => {
    try {
      await updateProfile(auth.currentUser, { displayName: nome });
      toast("Nome atualizado! ✓");
    } catch {
      toast("Erro ao salvar nome", "error");
    }
  };

  return (
    <div>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 24, color: text, margin: "0 0 24px", letterSpacing: -0.5 }}>Configurações</h1>

      <Card dark={dark} style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: text }}>Perfil</h2>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: sub, display: "block", marginBottom: 5 }}>Nome</label>
          <input style={inputStyle} value={nome} onChange={e => setNome(e.target.value)} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: sub, display: "block", marginBottom: 5 }}>Email</label>
          <input style={{ ...inputStyle, opacity: 0.6 }} value={user.email || ""} readOnly />
        </div>
        <Btn onClick={salvarNome} color="#25D366">Salvar Nome</Btn>
      </Card>

      <Card dark={dark}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: text }}>Aparência</h2>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: text }}>Modo Escuro</div>
            <div style={{ fontSize: 12, color: sub }}>Alterna entre tema claro e escuro</div>
          </div>
          <button onClick={() => setDark(!dark)} style={{ width: 52, height: 28, borderRadius: 14, border: "none", cursor: "pointer", background: dark ? "#25D366" : "#d1d5db", position: "relative", transition: "background .2s", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 3, left: dark ? 26 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark]         = useState(false);
  const [user, setUser]         = useState(null);       // Firebase user object
  const [authReady, setAuthReady] = useState(false);    // esperando onAuthStateChanged
  const [page, setPage]         = useState("dashboard");
  const [sideOpen, setSideOpen] = useState(false);
  const [mobile, setMobile]     = useState(window.innerWidth < 768);
  const [reports, setReports]   = useState([]);
  const { toasts, add: toast, remove } = useToast();

  // Observa mudanças de autenticação
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // Carrega relatórios do Firestore quando user loga
  useEffect(() => {
    if (!user) { setReports([]); return; }
    const load = async () => {
      try {
        const col = collection(db, "users", user.uid, "reports");
        const snap = await getDocs(query(col, orderBy("criadoEm", "asc")));
        setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Erro ao carregar relatórios:", e);
      }
    };
    load();
  }, [user]);

  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    setPage("dashboard");
    setSideOpen(false);
  };

  // Salva relatório no Firestore
  const handleSaveReport = async (data) => {
    try {
      const col = collection(db, "users", user.uid, "reports");
      const ref = await addDoc(col, data);
      setReports(p => [...p, { id: ref.id, ...data }]);
    } catch (e) {
      toast("Erro ao salvar no Firestore: " + e.message, "error");
    }
  };

  // Deleta relatório no Firestore (recebe o id)
  const handleDeleteReport = async (id) => {
    try {
      await deleteDoc(doc(db, "users", user.uid, "reports", id));
      setReports(p => p.filter(r => r.id !== id));
    } catch (e) {
      toast("Erro ao excluir: " + e.message, "error");
    }
  };

  const bg   = dark ? "#0a1628" : "#f1f5f9";
  const text = dark ? "#e2e8f0" : "#1e293b";

  const globalStyle = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
    * { font-family: 'Syne', sans-serif; box-sizing: border-box; }
    input, select, textarea, button { font-family: 'Syne', sans-serif !important; }
    @keyframes slideIn { from { transform: translateX(40px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
  `;

  // Aguardando Firebase inicializar
  if (!authReady) return (
    <>
      <style>{globalStyle}</style>
      <div style={{ minHeight: "100vh", background: dark ? "#0f172a" : "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: dark ? "#64748b" : "#94a3b8" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14 }}>Carregando...</div>
        </div>
      </div>
    </>
  );

  // Não autenticado — mostra tela de login/cadastro
  if (!user) return (
    <>
      <style>{globalStyle}</style>
      <AuthScreen dark={dark} />
      <Toast toasts={toasts} remove={remove} />
    </>
  );

  const pages = {
    dashboard: <Dashboard dark={dark} reports={reports} setPage={setPage} />,
    gerar:     <GerarRelatorio dark={dark} onSave={handleSaveReport} toast={toast} />,
    historico: <Historico dark={dark} reports={reports} setReports={handleDeleteReport} toast={toast} />,
    config:    <Configuracoes dark={dark} setDark={setDark} user={user} toast={toast} />,
  };

  return (
    <>
      <style>{globalStyle}</style>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: bg }}>
        <Sidebar
          page={page} setPage={setPage}
          dark={dark} setDark={setDark}
          user={user}
          mobile={mobile} open={sideOpen} setOpen={setSideOpen}
          onLogout={handleLogout}
        />
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {mobile && (
            <div style={{ padding: "14px 16px", background: dark ? "#1e293b" : "#fff", borderBottom: `1px solid ${dark ? "#334155" : "#e5e7eb"}`, display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
              <button onClick={() => setSideOpen(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: text, padding: 0 }}>☰</button>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, color: text }}>ClassReport</div>
            </div>
          )}
          <div style={{ flex: 1, padding: mobile ? "20px 16px" : "28px 32px", maxWidth: 860, width: "100%" }}>
            {pages[page] || pages["dashboard"]}
          </div>
        </div>
      </div>
      <Toast toasts={toasts} remove={remove} />
    </>
  );
} 