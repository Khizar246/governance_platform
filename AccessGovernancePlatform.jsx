import { useState } from "react";

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg:          "#F7F6F3",
  surface:     "#FFFFFF",
  surfaceAlt:  "#F0EFE9",
  navy:        "#0F1E3D",
  gold:        "#E8A900",
  goldLight:   "#FFF8E1",
  goldBright:  "#FFD100",
  text:        "#0F172A",
  textMid:     "#334155",
  textMuted:   "#64748B",
  textFaint:   "#94A3B8",
  border:      "#E2E8F0",
  borderLight: "#F1F0EA",
  green:       "#16A34A",
  greenBg:     "#DCFCE7",
  red:         "#DC2626",
  redBg:       "#FEE2E2",
  amber:       "#D97706",
  amberBg:     "#FEF3C7",
  blue:        "#2563EB",
  blueBg:      "#DBEAFE",
};

const G = `
  @import url('https://fonts.googleapis.com/css2?family=Lora:wght@400;600&family=DM+Sans:wght@300;400;500;600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Sans',sans-serif;background:${C.bg};color:${C.text}}
  .fade{animation:fadeIn .28s ease}
  @keyframes fadeIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
  .slide{animation:slideIn .2s ease}
  @keyframes slideIn{from{opacity:0;transform:translateX(-7px)}to{opacity:1;transform:translateX(0)}}
  ::-webkit-scrollbar{width:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px}
  @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  input:focus{outline:2px solid ${C.navy};outline-offset:1px}
`;

// ── Date / time helpers ────────────────────────────────────────────────────
const GREETING = (() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; })();
const TODAY_LABEL = new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", year:"numeric" });

// ── Shared styles ─────────────────────────────────────────────────────────
const card  = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" };
const badge = (col) => ({ display:"inline-flex", alignItems:"center", padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:600, letterSpacing:"0.05em", textTransform:"uppercase", ...col });
const btn   = (v="primary") => {
  const map = {
    primary:   { background:C.navy,       color:C.goldBright, border:"none" },
    secondary: { background:"transparent",color:C.textMid,    border:`1px solid ${C.border}` },
    ghost:     { background:"transparent",color:C.textMid,    border:"none" },
    gold:      { background:C.goldBright, color:C.navy,       border:"none" },
    danger:    { background:C.redBg,      color:C.red,        border:`1px solid #FCA5A5` },
  };
  return { display:"inline-flex", alignItems:"center", gap:6, padding:"9px 18px", borderRadius:8, fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", transition:"all .15s", ...map[v] };
};

// ── Status helpers ─────────────────────────────────────────────────────────
const STATUS_META = {
  operational: { color: C.green,  bg: C.greenBg,  label: "Operational" },
  maintenance:  { color: C.amber,  bg: C.amberBg,  label: "Maintenance"  },
  degraded:     { color: C.red,    bg: C.redBg,    label: "Degraded"     },
};
const StatusDot = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.operational;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"2px 8px", borderRadius:4, background:m.bg, fontSize:10, fontWeight:600, color:m.color, letterSpacing:"0.04em", textTransform:"uppercase" }}>
      <span style={{ width:5, height:5, borderRadius:"50%", background:m.color, flexShrink:0 }} />
      {m.label}
    </span>
  );
};

// ── Icons ──────────────────────────────────────────────────────────────────
const PATHS = {
  dashboard:    "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  entitlement:  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  fp:           "M9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4zm2 2H5V5h14v14zm0-16H5c-1.1 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  oracle:       "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  sod:          "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z",
  admin:        "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z",
  upload:       "M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z",
  check:        "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  right:        "M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z",
  left:         "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  chevron:      "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  chevronRight: "M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z",
  download:     "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  info:         "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  lock:         "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
  role:         "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  layers:       "M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z",
  database:     "M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.59 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4zm6 14c0 .5-2.13 2-6 2s-6-1.5-6-2v-2.23c1.61.78 3.72 1.23 6 1.23s4.39-.45 6-1.23V17zm0-4.55c-1.3.95-3.58 1.55-6 1.55s-4.7-.6-6-1.55V9.64C7.61 10.58 9.72 11 12 11s4.39-.42 6-1.36v2.81zM12 9C8.13 9 6 7.5 6 7s2.13-2 6-2 6 1.5 6 2-2.13 2-6 2z",
  edit:         "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  collapse:     "M11 19V13H5v-2h6V5l8 7z",
  expand:       "M13 5v6h6v2h-6v6l-8-7z",
  filter:       "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z",
  tag:          "M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z",
  clock:        "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z",
};
const Icon = ({ name, size=15, color="currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d={PATHS[name] || PATHS.info} />
  </svg>
);

// ── Reusable UI ────────────────────────────────────────────────────────────
const HelpBar = ({ title, icon, accentColor, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden", marginBottom:10, background:C.surface }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"11px 16px", background:open?C.bg:"transparent", border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", transition:"background .15s" }}>
        <div style={{ width:28, height:28, borderRadius:7, background:accentColor+"18", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <Icon name={icon} size={14} color={accentColor} />
        </div>
        <span style={{ fontSize:13, fontWeight:600, color:C.navy, flex:1, textAlign:"left" }}>{title}</span>
        <div style={{ transform:open?"rotate(180deg)":"rotate(0)", transition:"transform .22s", flexShrink:0 }}>
          <Icon name="chevron" size={16} color={C.textMuted} />
        </div>
      </button>
      {open && (
        <div className="slide" style={{ padding:"4px 16px 16px", borderTop:`1px solid ${C.borderLight}` }}>
          <div style={{ paddingTop:14 }}>{children}</div>
        </div>
      )}
    </div>
  );
};

const TemplateDownloads = ({ templates }) => (
  <div style={{ marginBottom:22 }}>
    <HelpBar title="Template Files" icon="download" accentColor={C.amber}>
      <p style={{ fontSize:12.5, color:C.textMuted, marginBottom:12, lineHeight:1.55 }}>
        Blank templates with the correct column headers pre-filled.
      </p>
      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        {templates.map(([name, fmt]) => (
          <div key={name}
            style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 11px", borderRadius:7, border:`1px solid ${C.border}`, cursor:"pointer", transition:"background .12s" }}
            onMouseOver={e => e.currentTarget.style.background = C.bg}
            onMouseOut={e  => e.currentTarget.style.background = "transparent"}>
            <Icon name="download" size={13} color={C.textMuted} />
            <span style={{ fontSize:13, color:C.textMid, flex:1 }}>{name}</span>
            <code style={{ fontSize:10, background:C.surfaceAlt, padding:"2px 7px", borderRadius:3, color:C.textMuted, fontFamily:"monospace" }}>{fmt}</code>
          </div>
        ))}
      </div>
    </HelpBar>
  </div>
);

const Stepper = ({ steps, current }) => (
  <div style={{ display:"flex", alignItems:"center", marginBottom:24 }}>
    {steps.map((step, i) => {
      const done = i < current, active = i === current;
      return (
        <div key={i} style={{ display:"flex", alignItems:"center", flex: i < steps.length-1 ? 1 : "none" }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
            <div style={{ width:30, height:30, borderRadius:"50%", background:done?C.green:active?C.navy:C.surfaceAlt, border:active?`2px solid ${C.navy}`:done?"none":`1.5px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", transition:"all .2s" }}>
              {done ? <Icon name="check" size={13} color="#fff" /> : <span style={{ fontSize:11, fontWeight:600, color:active?"#fff":C.textFaint }}>{i+1}</span>}
            </div>
            <span style={{ fontSize:10, fontWeight:active?600:400, color:active?C.navy:done?C.textMid:C.textFaint, letterSpacing:"0.05em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{step}</span>
          </div>
          {i < steps.length-1 && <div style={{ flex:1, height:1.5, background:done?C.green:C.border, margin:"0 8px", marginBottom:18, transition:"background .2s" }} />}
        </div>
      );
    })}
  </div>
);

const UploadZone = ({ label, hint, uploaded, onUpload }) => {
  const [drag, setDrag] = useState(false);
  return (
    <div onClick={() => onUpload?.("sample_file.xlsx")}
      onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);onUpload?.(e.dataTransfer.files[0]?.name||"file.xlsx")}}
      style={{ border:`1.5px dashed ${uploaded?C.green:drag?C.navy:C.border}`, borderRadius:10, padding:"22px 18px", textAlign:"center", cursor:"pointer", background:uploaded?C.greenBg:drag?"#EEF2FF":C.bg, transition:"all .15s" }}>
      {uploaded ? (
        <>
          <div style={{ width:34, height:34, background:C.greenBg, border:`1px solid #86EFAC`, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 8px" }}>
            <Icon name="check" size={16} color={C.green} />
          </div>
          <p style={{ fontSize:13, fontWeight:600, color:C.green }}>{uploaded}</p>
          <p style={{ fontSize:11, color:C.textFaint, marginTop:2 }}>Click to replace</p>
        </>
      ) : (
        <>
          <div style={{ width:34, height:34, background:C.surfaceAlt, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 8px" }}>
            <Icon name="upload" size={16} color={C.textMuted} />
          </div>
          <p style={{ fontSize:13, fontWeight:500, color:C.textMid }}>{label}</p>
          <p style={{ fontSize:11, color:C.textFaint, marginTop:3 }}>{hint}</p>
        </>
      )}
    </div>
  );
};

const SelectCard = ({ icon, title, tag, tagColor, description, meta, selected, recommended, onClick }) => (
  <div onClick={onClick} style={{ flex:1, border:selected?`2px solid ${C.navy}`:`1px solid ${C.border}`, borderRadius:12, padding:"20px 20px 16px", cursor:"pointer", background:selected?"#F8F9FF":C.surface, position:"relative", transition:"all .15s" }}>
    {recommended && <div style={{ position:"absolute", top:-1, right:14, background:C.gold, color:C.navy, fontSize:9, fontWeight:700, padding:"3px 9px", borderRadius:"0 0 5px 5px", letterSpacing:"0.05em" }}>RECOMMENDED</div>}
    <div style={{ width:38, height:38, borderRadius:9, background:selected?C.navy:C.surfaceAlt, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:12 }}>
      <Icon name={icon} size={18} color={selected?C.goldBright:C.textMuted} />
    </div>
    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:7 }}>
      <span style={{ fontSize:14, fontWeight:600, color:C.text }}>{title}</span>
      <span style={badge(tagColor)}>{tag}</span>
    </div>
    <p style={{ fontSize:12.5, color:C.textMuted, lineHeight:1.55 }}>{description}</p>
    {meta && <p style={{ fontSize:10.5, color:C.textFaint, marginTop:9, fontWeight:500 }}>{meta}</p>}
  </div>
);

const PageHeader = ({ icon, title, subtitle }) => (
  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
    <div style={{ width:38, height:38, borderRadius:9, background:C.navy, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <Icon name={icon} size={18} color={C.goldBright} />
    </div>
    <div>
      <h2 style={{ fontFamily:"'Lora',serif", fontSize:21, fontWeight:600, color:C.navy }}>{title}</h2>
      <p style={{ fontSize:12, color:C.textMuted }}>{subtitle}</p>
    </div>
  </div>
);

const SummaryBar = ({ label, value, onEdit }) => (
  <div style={{ padding:"9px 13px", borderRadius:7, background:C.surfaceAlt, display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
    <span style={{ fontSize:12, color:C.textMuted }}>{label}: <strong>{value}</strong></span>
    <button onClick={onEdit} style={{ ...btn("ghost"), padding:"3px 9px", fontSize:12, color:C.blue }}>Change</button>
  </div>
);

const ResultSuccess = ({ title, subtitle, stats, onNew, newLabel="New Analysis" }) => (
  <div className="slide">
    <div style={{ ...card, textAlign:"center", padding:44 }}>
      <div style={{ width:58, height:58, borderRadius:"50%", background:C.greenBg, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
        <Icon name="check" size={26} color={C.green} />
      </div>
      <h3 style={{ fontFamily:"'Lora',serif", fontSize:19, color:C.navy, marginBottom:7 }}>{title}</h3>
      <p style={{ fontSize:13, color:C.textMuted, marginBottom:22 }}>{subtitle}</p>
      <div style={{ display:"grid", gridTemplateColumns:`repeat(${stats.length},1fr)`, gap:10, marginBottom:22 }}>
        {stats.map(([l,v,bg,col]) => (
          <div key={l} style={{ background:bg, borderRadius:9, padding:14 }}>
            <span style={{ fontSize:24, fontFamily:"'Lora',serif", fontWeight:600, color:col }}>{v}</span>
            <p style={{ fontSize:11, fontWeight:500, color:col, marginTop:3 }}>{l}</p>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:9, justifyContent:"center" }}>
        <button onClick={onNew} style={btn("secondary")}>{newLabel}</button>
        <button style={btn("primary")}>Export Report</button>
      </div>
    </div>
  </div>
);

const HelpStep = ({ num, text }) => (
  <div style={{ display:"flex", gap:10, marginBottom:10 }}>
    <div style={{ width:22, height:22, borderRadius:"50%", background:C.surfaceAlt, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
      <span style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{num}</span>
    </div>
    <p style={{ fontSize:13, color:C.textMid, lineHeight:1.6, paddingTop:2 }}>{text}</p>
  </div>
);

const HelpPill = ({ label, note }) => (
  <div style={{ display:"flex", alignItems:"baseline", gap:9, padding:"8px 12px", borderRadius:7, background:C.bg, border:`1px solid ${C.borderLight}`, marginBottom:7 }}>
    <code style={{ fontSize:11, background:C.surfaceAlt, padding:"2px 7px", borderRadius:4, fontFamily:"monospace", color:C.navy, flexShrink:0 }}>{label}</code>
    <span style={{ fontSize:12.5, color:C.textMuted, lineHeight:1.5 }}>{note}</span>
  </div>
);

// ── Project tag field ──────────────────────────────────────────────────────
const ProjectField = ({ value, onChange }) => (
  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:9, background:C.surface, border:`1px solid ${C.border}`, marginBottom:20 }}>
    <Icon name="tag" size={14} color={C.textMuted} />
    <label style={{ fontSize:12, fontWeight:500, color:C.textMuted, whiteSpace:"nowrap" }}>Client / Project</label>
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="e.g. Accenture Q2 Audit"
      style={{ flex:1, border:"none", outline:"none", fontSize:13, fontFamily:"'DM Sans',sans-serif", color:C.text, background:"transparent" }}
    />
    {value && (
      <span style={{ ...badge({ background:C.goldLight, color:C.navy }), fontSize:9 }}>SET</span>
    )}
  </div>
);

// ══════════════════════════════════════════════════════════════════════════
// TOOL PAGES
// ══════════════════════════════════════════════════════════════════════════

// ── Entitlement Mapping ────────────────────────────────────────────────────
const EntitlementMapping = ({ onComplete }) => {
  const [project, setProject] = useState("");
  const [files, setFiles]     = useState({ client:null, ey:null });
  const [ran, setRan]         = useState(false);

  const run = () => {
    setRan(true);
    onComplete({ tool:"Entitlement Mapping", toolKey:"entitlement", type:"—", project });
  };

  return (
    <div className="fade">
      <PageHeader icon="entitlement" title="Entitlement Mapping" subtitle="Map client entitlements to EY rulesets using privilege overlap, Jaccard similarity, and name-based matching" />
      <ProjectField value={project} onChange={setProject} />
      <HelpBar title="How to use this tool" icon="info" accentColor={C.blue}>
        <HelpStep num={1} text="Prepare your Client Entitlement file — a CSV or XLSX with three required columns: Entitlement Name, Privilege Name, and Privilege Code. Each row represents one named privilege belonging to one entitlement." />
        <HelpStep num={2} text="Prepare your EY Ruleset file — a CSV or XLSX export from the EY entitlement library. It must use the same three columns as the client file: Entitlement Name, Privilege Name, and Privilege Code." />
        <HelpStep num={3} text="Upload both files using the zones below. The tool validates column names automatically and will flag any missing required columns before running." />
        <HelpStep num={4} text="Click Run Mapping. Results appear with a confidence score per match, and a Coverage Combination suggestion when the best-matching rule does not fully cover all client privileges. Export before closing — results are not stored between sessions." />
      </HelpBar>
      <HelpBar title="How the tool works" icon="layers" accentColor={C.navy}>
        <p style={{ fontSize:13, color:C.textMuted, lineHeight:1.7, marginBottom:12 }}>The mapping engine applies three algorithms in sequence and combines their scores into a single confidence rating:</p>
        <HelpPill label="Privilege Overlap" note="Counts the exact privilege code intersection between a client entitlement and an EY rule. A full overlap scores 100%." />
        <HelpPill label="Jaccard Similarity" note="Measures the ratio of shared privileges to the union of both sets — penalises over-broad or over-narrow rules." />
        <HelpPill label="Name-Based Match" note="Fuzzy string comparison on the entitlement and rule names, used as a tiebreaker for near-equal Jaccard scores." />
        <HelpPill label="Coverage Combination" note="When the best-matching rule covers only a subset of client privileges, the engine tests whether adding 1–2 runner-up rules achieves full coverage — reported as 'Rule A + Rule B' in the output." />
        <p style={{ fontSize:12.5, color:C.textFaint, marginTop:10, lineHeight:1.6 }}>Matches above 80% are flagged High Confidence, 50–80% Medium, below 50% Low. Low-confidence rows should be reviewed manually before use in a report.</p>
      </HelpBar>
      <TemplateDownloads templates={[["Client Entitlement Template","CSV / XLSX"],["EY Ruleset Template","CSV / XLSX"]]} />

      {!ran ? (
        <div style={card}>
          <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>Upload Files</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:18 }}>
            <div>
              <p style={{ fontSize:12, fontWeight:500, color:C.textMid, marginBottom:7 }}>Client Entitlement File</p>
              <UploadZone label="Upload Client CSV / XLSX" hint="Columns: Entitlement Name, Privilege Name, Privilege Code" uploaded={files.client} onUpload={f=>setFiles(s=>({...s,client:f}))} />
            </div>
            <div>
              <p style={{ fontSize:12, fontWeight:500, color:C.textMid, marginBottom:7 }}>EY Ruleset File</p>
              <UploadZone label="Upload EY Ruleset CSV / XLSX" hint="Columns: Entitlement Name, Privilege Name, Privilege Code" uploaded={files.ey} onUpload={f=>setFiles(s=>({...s,ey:f}))} />
            </div>
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end" }}>
            <button onClick={run} disabled={!files.client||!files.ey} style={{ ...btn("gold"), opacity:files.client&&files.ey?1:0.4 }}>
              Run Mapping <Icon name="right" size={13} color={C.navy} />
            </button>
          </div>
        </div>
      ) : (
        <div className="slide" style={card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <h3 style={{ fontSize:14, fontWeight:600, color:C.navy }}>Mapping Results</h3>
            <div style={{ display:"flex", gap:7 }}>
              <button style={btn("secondary")}>Export CSV</button>
              <button onClick={()=>{setFiles({client:null,ey:null});setRan(false);}} style={btn("ghost")}>New Run</button>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:18 }}>
            {[["High Confidence","84",C.greenBg,C.green],["Medium Confidence","31",C.amberBg,C.amber],["Low / Unmatched","12",C.redBg,C.red]].map(([l,v,bg,col])=>(
              <div key={l} style={{ background:bg, borderRadius:9, padding:"13px 15px" }}>
                <span style={{ fontSize:24, fontFamily:"'Lora',serif", fontWeight:600, color:col }}>{v}</span>
                <p style={{ fontSize:11, fontWeight:500, color:col, marginTop:3 }}>{l}</p>
              </div>
            ))}
          </div>
          <div style={{ borderTop:`1px solid ${C.borderLight}`, paddingTop:12 }}>
            {[["AP_INVOICE_APPROVAL","Accounts Payable Approval","Invoice Approval Rule","96%"],["GL_JOURNAL_ENTRY","General Ledger Entry","Journal Entry Rule","91%"],["PO_CREATE_ORDER","Create Purchase Order","Procurement Creation","78%"],["AR_RECEIPT_APPLY","Apply AR Receipt","AR Receipt Rule","61%"]].map(([code,cl,ey,score])=>(
              <div key={code} style={{ display:"flex", alignItems:"center", gap:11, padding:"9px 0", borderBottom:`1px solid ${C.borderLight}` }}>
                <code style={{ fontSize:10.5, background:C.surfaceAlt, padding:"2px 6px", borderRadius:4, color:C.textMid, fontFamily:"monospace", minWidth:140 }}>{code}</code>
                <span style={{ fontSize:12.5, color:C.textMid, flex:1 }}>{cl}</span>
                <span style={{ fontSize:12, color:C.textMuted, flex:1 }}>→ {ey}</span>
                <span style={{ fontSize:12, fontWeight:600, color:parseFloat(score)>80?C.green:parseFloat(score)>60?C.amber:C.red }}>{score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── FP Analysis ────────────────────────────────────────────────────────────
const FPAnalysis = ({ onComplete }) => {
  const [project, setProject] = useState("");
  const [step, setStep]       = useState(0);
  const [mode, setMode]       = useState(null);
  const [sheets, setSheets]   = useState({ roleSod:true, roleSa:true, userSod:true, userSa:true });
  const [files, setFiles]     = useState({ sod:null, fp:null });

  const reset = () => { setStep(0); setMode(null); setFiles({sod:null,fp:null}); };
  const run   = () => {
    setStep(3);
    onComplete({ tool:"False Positive Analysis", toolKey:"fp", type:mode==="privilege"?"Privilege Level":"Entitlement Level", project });
  };

  return (
    <div className="fade">
      <PageHeader icon="fp" title="False Positive Analysis" subtitle="3-level FP classification — False Positive · Single Leg · True Conflict" />
      <ProjectField value={project} onChange={setProject} />
      <HelpBar title="How to use this tool" icon="info" accentColor={C.blue}>
        <HelpStep num={1} text="Choose a mode. Privilege Level analyses each individual privilege pair — use for detailed audit reports. Entitlement Level aggregates up to the entitlement — use for management summaries." />
        <HelpStep num={2} text="On the Configure screen, select which violation sheets from the SOD output you want to include. You can run Role-only, User-only, or both together." />
        <HelpStep num={3} text="Upload the SOD Analysis Output XLSX (produced by the SOD & SA Analysis tool) and the FP Database XLSX (the master false-positive register maintained by the team)." />
        <HelpStep num={4} text="Click Run Analysis. Results classify every violation row as False Positive, Single Leg, or True Conflict. Export before closing — results are not stored." />
      </HelpBar>
      <HelpBar title="How the tool works" icon="layers" accentColor={C.navy}>
        <p style={{ fontSize:13, color:C.textMuted, lineHeight:1.7, marginBottom:12 }}>Each privilege pair from the SOD output is looked up against the FP Database and placed into one of three buckets:</p>
        <HelpPill label="False Positive" note="Both privileges appear in the No_action_Privileges sheet — the conflict is known-safe and can be removed from the report." />
        <HelpPill label="Single Leg" note="Only one privilege is in the FP database. The conflict is partially mitigated but still requires a compensating control note." />
        <HelpPill label="True Conflict" note="Neither privilege is in the FP database. This is a live violation that must appear in the final deliverable." />
        <p style={{ fontSize:12.5, color:C.textFaint, marginTop:10, lineHeight:1.6 }}>At Entitlement Level mode, an entitlement is only marked False Positive if every constituent privilege pair within it is FP — a single True Conflict escalates the whole entitlement.</p>
      </HelpBar>
      <TemplateDownloads templates={[["FP Database Template","XLSX"],["SOD Analysis Output Template","XLSX"]]} />

      <Stepper steps={["Mode","Configure","Upload","Results"]} current={step} />

      {step===0 && (
        <div className="slide">
          <div style={{ display:"flex", gap:14 }}>
            <SelectCard icon="fp" title="Privilege Level" tag="Granular" tagColor={{ background:C.blueBg, color:"#1D4ED8" }}
              description="Classify each individual privilege pair. Recommended for detailed audit reports."
              selected={mode==="privilege"} onClick={()=>setMode("privilege")} />
            <SelectCard icon="layers" title="Entitlement Level" tag="High-Level" tagColor={{ background:C.amberBg, color:C.amber }}
              description="Classify entire entitlement groups based on constituent privileges. Recommended for management reporting."
              selected={mode==="entitlement"} onClick={()=>setMode("entitlement")} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:20 }}>
            <button disabled={!mode} onClick={()=>setStep(1)} style={{ ...btn("primary"), opacity:mode?1:0.4 }}>
              Continue <Icon name="right" size={13} color={C.goldBright} />
            </button>
          </div>
        </div>
      )}

      {step===1 && (
        <div className="slide">
          <div style={card}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:18 }}>
              <span style={{ fontSize:12, color:C.textMuted }}>Mode:</span>
              <span style={badge({ background:C.blueBg, color:"#1D4ED8" })}>{mode==="privilege"?"Privilege Level":"Entitlement Level"}</span>
            </div>
            <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>Violation sheets to analyse</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>
              {[{key:"role",items:[["roleSod","Role SoD"],["roleSa","Role SA"]]},{key:"user",items:[["userSod","User SoD"],["userSa","User SA"]]}].map(group=>(
                <div key={group.key}>
                  <p style={{ fontSize:10.5, fontWeight:600, color:C.textMuted, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:9 }}>{group.key} Analysis</p>
                  {group.items.map(([k,label])=>(
                    <label key={k} style={{ display:"flex", alignItems:"center", gap:9, padding:"9px 12px", borderRadius:7, border:`1px solid ${sheets[k]?C.navy:C.border}`, background:sheets[k]?"#F0F4FF":C.surface, marginBottom:7, cursor:"pointer" }}>
                      <div style={{ width:17, height:17, borderRadius:4, border:`2px solid ${sheets[k]?C.navy:C.border}`, background:sheets[k]?C.navy:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        {sheets[k] && <Icon name="check" size={10} color="#fff" />}
                      </div>
                      <input type="checkbox" checked={sheets[k]} onChange={()=>setSheets(s=>({...s,[k]:!s[k]}))} style={{ display:"none" }} />
                      <span style={{ fontSize:13, fontWeight:sheets[k]?500:400, color:sheets[k]?C.navy:C.textMid }}>{label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:18 }}>
            <button onClick={()=>setStep(0)} style={btn("secondary")}><Icon name="left" size={13} color={C.textMid} /> Change Mode</button>
            <button onClick={()=>setStep(2)} style={btn("primary")}>Continue <Icon name="right" size={13} color={C.goldBright} /></button>
          </div>
        </div>
      )}

      {step===2 && (
        <div className="slide">
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:9 }}>SOD Analysis Output</p>
              <UploadZone label="Upload SOD Output XLSX" hint="Sheets: ROLE_DETAILS, Role SoD, Role SA, User SoD, User SA" uploaded={files.sod} onUpload={f=>setFiles(s=>({...s,sod:f}))} />
            </div>
            <div>
              <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:9 }}>FP Database</p>
              <UploadZone label="Upload FP Database XLSX" hint="Sheets: No_action_Privileges, WorkArea_Privileges" uploaded={files.fp} onUpload={f=>setFiles(s=>({...s,fp:f}))} />
            </div>
          </div>
          <SummaryBar label="Mode" value={`${mode==="privilege"?"Privilege Level":"Entitlement Level"} — Sheets: ${[sheets.roleSod&&"Role SoD",sheets.roleSa&&"Role SA",sheets.userSod&&"User SoD",sheets.userSa&&"User SA"].filter(Boolean).join(", ")||"None selected"}`} onEdit={()=>setStep(1)} />
          <div style={{ display:"flex", justifyContent:"space-between" }}>
            <button onClick={()=>setStep(1)} style={btn("secondary")}><Icon name="left" size={13} color={C.textMid} /> Back</button>
            <button onClick={run} disabled={!files.sod||!files.fp} style={{ ...btn("gold"), opacity:files.sod&&files.fp?1:0.4 }}>
              Run Analysis <Icon name="right" size={13} color={C.navy} />
            </button>
          </div>
        </div>
      )}

      {step===3 && <ResultSuccess title="Analysis Complete" subtitle="Your FP analysis has been processed successfully."
        stats={[["False Positives","47",C.greenBg,C.green],["Single Leg","23",C.amberBg,C.amber],["True Conflicts","12",C.redBg,C.red]]}
        onNew={reset} />}
    </div>
  );
};

// ── Oracle Comparator ──────────────────────────────────────────────────────
const OracleComparator = ({ onComplete }) => {
  const [project, setProject] = useState("");
  const [step, setStep]       = useState(0);
  const [type, setType]       = useState(null);
  const [env, setEnv]         = useState({ e1:"", e2:"" });
  const [files, setFiles]     = useState({ rbac1:null, rbac2:null, dsp1:null, dsp2:null });

  const needsRBAC = type==="rbac"||type==="complete";
  const needsDSP  = type==="dsp" ||type==="complete";
  const rbacReady = !needsRBAC || (!!files.rbac1 && !!files.rbac2);
  const dspReady  = !needsDSP  || (!!files.dsp1  && !!files.dsp2);
  const canRun    = rbacReady && dspReady;
  const reset = () => { setStep(0); setType(null); setFiles({rbac1:null,rbac2:null,dsp1:null,dsp2:null}); };
  const run   = () => {
    setStep(2);
    onComplete({ tool:"Oracle Role Comparison", toolKey:"oracle", type:type==="rbac"?"RBAC Analysis":type==="dsp"?"DSP Analysis":"Complete Analysis", project });
  };

  return (
    <div className="fade">
      <PageHeader icon="oracle" title="Oracle Role Comparison" subtitle="Compare duty roles, privileges, and DSP across two Oracle environments" />
      <ProjectField value={project} onChange={setProject} />
      <HelpBar title="How to use this tool" icon="info" accentColor={C.blue}>
        <HelpStep num={1} text="Choose your analysis type. RBAC Analysis compares duty roles, inherited role assignments, and privilege-to-role mappings. DSP Analysis compares data security policies, condition statements, and column-level grants. Complete Analysis covers both and is recommended for production-to-UAT sign-off comparisons." />
        <HelpStep num={2} text="Enter a short label for each environment (e.g. 'Production', 'UAT') — these labels appear in the output to distinguish which side each row belongs to." />
        <HelpStep num={3} text="Export the required files from Oracle Fusion for each environment. For RBAC: Security Console → Roles → Export. For DSP: Security Console → Data Security Policies → Export. Upload each file to its corresponding zone." />
        <HelpStep num={4} text="Click Run Comparison. The output lists objects unique to each environment and those present in both. Export before closing." />
      </HelpBar>
      <HelpBar title="How the tool works" icon="layers" accentColor={C.navy}>
        <p style={{ fontSize:13, color:C.textMuted, lineHeight:1.7, marginBottom:12 }}>The comparator performs a bi-directional set difference between the two environment exports:</p>
        <HelpPill label="RBAC comparison" note="Computes (Env1 − Env2), (Env2 − Env1), and the intersection across duty roles, inherited role links, and privilege-to-role mappings." />
        <HelpPill label="DSP comparison" note="Applies the same set logic to data security policies: object name, condition statement, and column-level access grants compared independently." />
        <HelpPill label="Key matching" note="Rows are matched on a composite key of ROLE_NAME + ENTITLEMENT (RBAC) or POLICY_NAME + OBJECT_NAME (DSP). Whitespace and case are normalised before matching." />
        <p style={{ fontSize:12.5, color:C.textFaint, marginTop:10, lineHeight:1.6 }}>Particularly useful for post-migration checks — anything in Env1 but absent from Env2 is a potential missed configuration.</p>
      </HelpBar>
      <TemplateDownloads templates={[["RBAC Export Template","CSV"],["DSP Export Template","CSV"]]} />

      <Stepper steps={["Analysis Type","Upload Files","Results"]} current={step} />

      {step===0 && (
        <div className="slide">
          <div style={{ display:"flex", gap:14 }}>
            <SelectCard icon="role" title="RBAC Analysis" tag="2 Files" tagColor={{ background:C.blueBg, color:"#1D4ED8" }}
              description="Compare duty roles, inherited role assignments, and privilege-to-role mappings between two Oracle environments."
              meta="2 RBAC FILES" selected={type==="rbac"} onClick={()=>setType("rbac")} />
            <SelectCard icon="database" title="DSP Analysis" tag="2 Files" tagColor={{ background:C.amberBg, color:C.amber }}
              description="Compare data security policies, condition statements, and column-level access controls across environments."
              meta="2 DSP FILES" selected={type==="dsp"} onClick={()=>setType("dsp")} />
            <SelectCard icon="layers" title="Complete Analysis" tag="Recommended" tagColor={{ background:C.greenBg, color:C.green }}
              description="Full bi-directional comparison covering both RBAC and DSP. Requires two pairs of files plus environment names."
              meta="4 FILES TOTAL" selected={type==="complete"} recommended onClick={()=>setType("complete")} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:20 }}>
            <button disabled={!type} onClick={()=>setStep(1)} style={{ ...btn("primary"), opacity:type?1:0.4 }}>
              Continue <Icon name="right" size={13} color={C.goldBright} />
            </button>
          </div>
        </div>
      )}

      {step===1 && (
        <div className="slide">
          <div style={card}>
            <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>Environment Names</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:20 }}>
              {[["Environment 1","e1","e.g. Production"],["Environment 2","e2","e.g. Development"]].map(([label,key,ph])=>(
                <div key={key}>
                  <label style={{ fontSize:11.5, fontWeight:500, color:C.textMuted, display:"block", marginBottom:5 }}>{label}</label>
                  <input value={env[key]} onChange={e=>setEnv(s=>({...s,[key]:e.target.value}))} placeholder={ph}
                    style={{ width:"100%", padding:"9px 13px", border:`1px solid ${C.border}`, borderRadius:8, fontSize:13, fontFamily:"'DM Sans',sans-serif", outline:"none", color:C.text, background:C.surface }} />
                </div>
              ))}
            </div>
            {needsRBAC && (
              <>
                <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>RBAC Files</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:needsDSP?20:0 }}>
                  <UploadZone label={`${env.e1||"Environment 1"} RBAC`} hint="Columns: ROLE NAME, ENTITLEMENT, INHERITED ROLE NAME" uploaded={files.rbac1} onUpload={f=>setFiles(s=>({...s,rbac1:f}))} />
                  <UploadZone label={`${env.e2||"Environment 2"} RBAC`} hint="Columns: ROLE NAME, ENTITLEMENT, INHERITED ROLE NAME" uploaded={files.rbac2} onUpload={f=>setFiles(s=>({...s,rbac2:f}))} />
                </div>
              </>
            )}
            {needsDSP && (
              <>
                <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>DSP Files</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
                  <UploadZone label={`${env.e1||"Environment 1"} DSP`} hint="Columns: ROLE NAME, INHERITED ROLE NAME, GRANT END DATE, OBJECT NAME, FUNCTION NAME, INSTANCE SET NAME" uploaded={files.dsp1} onUpload={f=>setFiles(s=>({...s,dsp1:f}))} />
                  <UploadZone label={`${env.e2||"Environment 2"} DSP`} hint="Columns: ROLE NAME, INHERITED ROLE NAME, GRANT END DATE, OBJECT NAME, FUNCTION NAME, INSTANCE SET NAME" uploaded={files.dsp2} onUpload={f=>setFiles(s=>({...s,dsp2:f}))} />
                </div>
              </>
            )}
          </div>
          <SummaryBar label="Type" value={type==="rbac"?"RBAC Analysis":type==="dsp"?"DSP Analysis":"Complete Analysis"} onEdit={()=>setStep(0)} />
          <div style={{ display:"flex", justifyContent:"space-between" }}>
            <button onClick={()=>setStep(0)} style={btn("secondary")}><Icon name="left" size={13} color={C.textMid} /> Change Type</button>
            <button onClick={run} disabled={!canRun} style={{ ...btn("gold"), opacity:canRun?1:0.4 }}>Run Comparison <Icon name="right" size={13} color={C.navy} /></button>
          </div>
        </div>
      )}

      {step===2 && <ResultSuccess title="Comparison Complete"
        subtitle={`Compared ${env.e1||"Environment 1"} against ${env.e2||"Environment 2"}.`}
        stats={[["Only in E1","34",C.blueBg,C.blue],["Only in E2","18",C.amberBg,C.amber],["In Both","142",C.greenBg,C.green]]}
        onNew={reset} newLabel="New Comparison" />}
    </div>
  );
};

// ── SOD & SA Analysis ─────────────────────────────────────────────────────
const SODAnalysis = ({ onComplete }) => {
  const [project, setProject] = useState("");
  const [step, setStep]       = useState(0);
  const [type, setType]       = useState(null);
  const [files, setFiles]     = useState({ hierarchy:null, ruleset:null, userRole:null });
  const [progress, setProgress] = useState(0);

  const reset = () => { setStep(0); setType(null); setFiles({hierarchy:null,ruleset:null,userRole:null}); setProgress(0); };
  const run = () => {
    setStep(2);
    let p=0;
    const t=setInterval(()=>{
      p+=Math.random()*14;
      if(p>=100){p=100;clearInterval(t);setTimeout(()=>{
        setStep(3);
        onComplete({ tool:"SOD & SA Analysis", toolKey:"sod", type:type==="role"?"Role Analysis":type==="user"?"User Analysis":"Role + User", project });
      },300);}
      setProgress(Math.min(100,p));
    },280);
  };

  return (
    <div className="fade">
      <PageHeader icon="sod" title="SOD & SA Analysis" subtitle="Segregation of Duties and Sensitive Access violation detection at role and user level" />
      <ProjectField value={project} onChange={setProject} />
      <HelpBar title="How to use this tool" icon="info" accentColor={C.blue}>
        <HelpStep num={1} text="Choose your scope. Role Analysis needs 2 files and is faster. User Analysis needs 3 files and attributes violations to individual users. Role + User is the recommended default for client deliverables." />
        <HelpStep num={2} text="Upload the Role Hierarchy CSV/XLSX — export from Oracle Fusion via Security Console → Roles → Export Hierarchy. Required columns: TOP_ROLE_CODE, ROLE_CODE, PRIVILEGE_CODE." />
        <HelpStep num={3} text="Upload the SOD SA Ruleset XLSX — the standard EY ruleset file. Must contain three sheets: SoD Ruleset, SA Ruleset, and Entitlement to Privilege." />
        <HelpStep num={4} text="If running User Analysis, also upload the User Role Membership CSV — export from Oracle via Manage Users → Export. Required columns: User Name, Assigned Role Name." />
        <HelpStep num={5} text="Click Run Analysis. A progress bar shows chunked processing. Export the output before closing — results are not stored between sessions." />
      </HelpBar>
      <HelpBar title="How the tool works" icon="layers" accentColor={C.navy}>
        <p style={{ fontSize:13, color:C.textMuted, lineHeight:1.7, marginBottom:12 }}>The engine flattens the role hierarchy and checks every resolved privilege combination against the ruleset:</p>
        <HelpPill label="Hierarchy flattening" note="Starting from each top-level role, the tool recursively resolves all inherited sub-roles down to leaf privileges, producing a flat privilege set per role." />
        <HelpPill label="SoD detection" note="Every pair of privileges within a role's flat set is checked against the SoD Ruleset. Matching pairs are recorded as violations with the conflicting function names." />
        <HelpPill label="SA detection" note="Each individual privilege is checked against the SA Ruleset independently. Sensitive access violations are reported separately from SoD." />
        <HelpPill label="User expansion" note="When User Analysis is included, each user's assigned roles are resolved through the hierarchy and the same checks are applied, attributing violations to named users." />
        <p style={{ fontSize:12.5, color:C.textFaint, marginTop:10, lineHeight:1.6 }}>Large hierarchies are processed in chunks to avoid memory limits — the progress bar reflects chunk completion, not individual row count.</p>
      </HelpBar>
      <TemplateDownloads templates={[["Role Hierarchy Template","CSV"],["SOD SA Ruleset Template","XLSX"],["User Role Membership Template","CSV"]]} />

      <Stepper steps={["Analysis Type","Upload Files","Processing","Results"]} current={step} />

      {step===0 && (
        <div className="slide">
          <div style={{ display:"flex", gap:14 }}>
            <SelectCard icon="sod" title="Role Analysis" tag="2 Files" tagColor={{ background:C.blueBg, color:"#1D4ED8" }}
              description="Detect SOD and SA violations at the role level. Requires Role Hierarchy and Ruleset files only."
              meta="2 FILES REQUIRED" selected={type==="role"} onClick={()=>setType("role")} />
            <SelectCard icon="role" title="User Analysis" tag="3 Files" tagColor={{ background:C.amberBg, color:C.amber }}
              description="Detect violations assigned to specific users. Requires all three files including User Role Membership."
              meta="3 FILES REQUIRED" selected={type==="user"} onClick={()=>setType("user")} />
            <SelectCard icon="layers" title="Role + User" tag="Recommended" tagColor={{ background:C.greenBg, color:C.green }}
              description="Full analysis: detect violations at both role and user level. Most comprehensive option."
              meta="3 FILES REQUIRED" selected={type==="both"} recommended onClick={()=>setType("both")} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", marginTop:20 }}>
            <button disabled={!type} onClick={()=>setStep(1)} style={{ ...btn("primary"), opacity:type?1:0.4 }}>
              Continue <Icon name="right" size={13} color={C.goldBright} />
            </button>
          </div>
        </div>
      )}

      {step===1 && (
        <div className="slide">
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <div>
              <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:9 }}>Role Hierarchy Report</p>
              <UploadZone label="Upload Role Hierarchy CSV / XLSX" hint="Columns: TOP_ROLE_CODE, ROLE_CODE, PRIVILEGE_CODE" uploaded={files.hierarchy} onUpload={f=>setFiles(s=>({...s,hierarchy:f}))} />
            </div>
            <div>
              <p style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:9 }}>SOD SA Ruleset</p>
              <UploadZone label="Upload Ruleset XLSX" hint="Sheets: SoD Ruleset, SA Ruleset, Entitlement to Privilege" uploaded={files.ruleset} onUpload={f=>setFiles(s=>({...s,ruleset:f}))} />
            </div>
          </div>
          {(type==="user"||type==="both") && (
            <div style={{ marginBottom:14 }}>
              <p style={{ fontSize:10, fontWeight:600, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:9 }}>
                <span style={{ color:C.textFaint }}>User Role Membership </span>
                <span style={{ color:C.red, fontFamily:"monospace", fontSize:9 }}>(required for user analysis)</span>
              </p>
              <UploadZone label="Upload User Role CSV / XLSX" hint="Columns: User Name, Assigned Role Name" uploaded={files.userRole} onUpload={f=>setFiles(s=>({...s,userRole:f}))} />
            </div>
          )}
          <SummaryBar label="Analysis Type" value={type==="role"?"Role Analysis":type==="user"?"User Analysis":"Role + User"} onEdit={()=>setStep(0)} />
          <div style={{ display:"flex", justifyContent:"space-between" }}>
            <button onClick={()=>setStep(0)} style={btn("secondary")}><Icon name="left" size={13} color={C.textMid} /> Change Type</button>
            <button onClick={run} disabled={!files.hierarchy||!files.ruleset||((type==="user"||type==="both")&&!files.userRole)} style={{ ...btn("gold"), opacity:(files.hierarchy&&files.ruleset&&(type==="role"||!!files.userRole))?1:0.4 }}>
              Run Analysis <Icon name="right" size={13} color={C.navy} />
            </button>
          </div>
        </div>
      )}

      {step===2 && (
        <div className="slide">
          <div style={{ ...card, textAlign:"center", padding:52 }}>
            <div style={{ width:56, height:56, borderRadius:"50%", background:C.surfaceAlt, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 18px", animation:"spin 1.4s linear infinite" }}>
              <Icon name="sod" size={24} color={C.navy} />
            </div>
            <h3 style={{ fontFamily:"'Lora',serif", fontSize:19, color:C.navy, marginBottom:7 }}>Processing Analysis</h3>
            <p style={{ fontSize:13, color:C.textMuted, marginBottom:26 }}>Scanning role hierarchy and detecting violations…</p>
            <div style={{ background:C.borderLight, borderRadius:4, height:5, overflow:"hidden", maxWidth:300, margin:"0 auto" }}>
              <div style={{ height:"100%", width:`${progress}%`, background:C.navy, borderRadius:4, transition:"width .28s ease" }} />
            </div>
            <p style={{ fontSize:12, color:C.textFaint, marginTop:9 }}>{Math.round(progress)}% complete</p>
          </div>
        </div>
      )}

      {step===3 && <ResultSuccess title="Analysis Complete" subtitle="SOD & SA violation detection finished successfully."
        stats={[["SoD (Role)","28",C.redBg,C.red],["SoD (User)","14",C.redBg,C.red],["SA (Role)","9",C.amberBg,C.amber],["SA (User)","6",C.amberBg,C.amber]]}
        onNew={reset} />}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════
const TOOL_DEFS = [
  { key:"entitlement", name:"Entitlement Mapping",      tag:"Mapping",    tagStyle:{ background:"#FEF9C3",  color:"#854D0E" }, icon:"entitlement", desc:"Map client entitlements to EY rulesets using privilege overlap, Jaccard similarity, name-based matching, and coverage combination analysis.", meta:"Avg 14 sec · 2 CSV/XLSX" },
  { key:"fp",          name:"False Positive Analysis",  tag:"Analysis",   tagStyle:{ background:C.blueBg,   color:"#1D4ED8" }, icon:"fp",          desc:"3-level FP classification — False Positive, Single Leg, True Conflict — at privilege or aggregated entitlement level.", meta:"Avg 28 sec · 2 XLSX" },
  { key:"oracle",      name:"Oracle Role Comparison",   tag:"Compare",    tagStyle:{ background:C.greenBg,  color:"#15803D" }, icon:"oracle",      desc:"Bi-directional RBAC and DSP comparison across Oracle Fusion environments using native set operations.", meta:"Avg 22 sec · 2–4 CSV" },
  { key:"sod",         name:"SOD & SA Analysis",        tag:"Compliance", tagStyle:{ background:C.redBg,    color:"#991B1B" }, icon:"sod",         desc:"Segregation of Duties and Sensitive Access violation detection at role and user level with chunked processing.", meta:"Avg 45 sec · 2–3 files" },
];

const Dashboard = ({ navigate, toolStatuses }) => (
  <div className="fade">
    <div style={{ marginBottom:28 }}>
      <h1 style={{ fontFamily:"'Lora',serif", fontSize:25, fontWeight:600, color:C.navy, lineHeight:1.2 }}>{GREETING}, Mohd Khizar</h1>
      <p style={{ fontSize:13, color:C.textMuted, marginTop:4 }}>{TODAY_LABEL}</p>
    </div>
    <p style={{ fontSize:10.5, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:14 }}>Tools</p>
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {TOOL_DEFS.map(tool => {
        const status = toolStatuses[tool.key] || "operational";
        const disabled = status === "maintenance";
        return (
          <div key={tool.key} style={{ ...card, display:"flex", alignItems:"center", gap:14, padding:"16px 20px", opacity:disabled?0.75:1 }}>
            <div style={{ width:44, height:44, borderRadius:10, background:disabled?C.textFaint:C.navy, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <Icon name={tool.icon} size={20} color={disabled?"#ccc":C.goldBright} />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                <span style={{ fontSize:14, fontWeight:600, color:C.text }}>{tool.name}</span>
                <span style={badge(tool.tagStyle)}>{tool.tag}</span>
                <StatusDot status={status} />
              </div>
              <p style={{ fontSize:12.5, color:C.textMuted, lineHeight:1.5 }}>{tool.desc}</p>
              <p style={{ fontSize:11, color:C.textFaint, marginTop:4 }}>{tool.meta}</p>
            </div>
            <button
              onClick={() => !disabled && navigate(tool.key)}
              disabled={disabled}
              style={{ ...btn(disabled?"secondary":"primary"), opacity:disabled?0.5:1, cursor:disabled?"not-allowed":"pointer" }}
            >
              {disabled ? "Unavailable" : <>Launch <Icon name="right" size={13} color={C.goldBright} /></>}
            </button>
          </div>
        );
      })}
    </div>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════
// ADMIN PAGE
// ══════════════════════════════════════════════════════════════════════════
const SEED_LOG = [
  { id:1,  tool:"SOD & SA Analysis",        toolKey:"sod",         type:"Role + User",       user:"Mohd Khizar", project:"Accenture Q2 Audit",     date:"May 3, 2026",  time:"10:42 AM" },
  { id:2,  tool:"False Positive Analysis",  toolKey:"fp",          type:"Privilege Level",   user:"Sara Ahmed",  project:"Deloitte Migration Check", date:"May 3, 2026",  time:"09:15 AM" },
  { id:3,  tool:"Oracle Role Comparison",   toolKey:"oracle",      type:"Complete Analysis", user:"Mohd Khizar", project:"Accenture Q2 Audit",     date:"May 2, 2026",  time:"4:50 PM"  },
  { id:4,  tool:"Entitlement Mapping",      toolKey:"entitlement", type:"—",                 user:"Lena Okafor", project:"HSBC Readiness Review",   date:"May 2, 2026",  time:"2:11 PM"  },
  { id:5,  tool:"SOD & SA Analysis",        toolKey:"sod",         type:"Role Analysis",     user:"Sara Ahmed",  project:"Deloitte Migration Check", date:"Apr 30, 2026", time:"3:28 PM"  },
  { id:6,  tool:"False Positive Analysis",  toolKey:"fp",          type:"Entitlement Level", user:"James Tan",   project:"Barclays UAT Sign-off",   date:"Apr 29, 2026", time:"11:00 AM" },
  { id:7,  tool:"Oracle Role Comparison",   toolKey:"oracle",      type:"RBAC Analysis",     user:"Mohd Khizar", project:"Accenture Q2 Audit",     date:"Apr 28, 2026", time:"5:17 PM"  },
  { id:8,  tool:"Entitlement Mapping",      toolKey:"entitlement", type:"—",                 user:"Lena Okafor", project:"HSBC Readiness Review",   date:"Apr 27, 2026", time:"9:44 AM"  },
  { id:9,  tool:"SOD & SA Analysis",        toolKey:"sod",         type:"User Analysis",     user:"James Tan",   project:"Barclays UAT Sign-off",   date:"Apr 25, 2026", time:"2:00 PM"  },
  { id:10, tool:"Oracle Role Comparison",   toolKey:"oracle",      type:"DSP Analysis",      user:"Sara Ahmed",  project:"Deloitte Migration Check", date:"Apr 24, 2026", time:"10:30 AM" },
];

const TAG_COLORS = {
  entitlement: { background:"#FEF9C3", color:"#854D0E" },
  fp:          { background:C.blueBg,  color:"#1D4ED8"  },
  oracle:      { background:C.greenBg, color:"#15803D"  },
  sod:         { background:C.redBg,   color:"#991B1B"  },
};

const AdminPage = ({ runLog, toolStatuses, setToolStatuses }) => {
  const [filterTool, setFilterTool]   = useState("all");
  const [filterUser, setFilterUser]   = useState("all");
  const [filterProj, setFilterProj]   = useState("all");

  const allTools   = ["all", ...new Set(runLog.map(r=>r.toolKey))];
  const allUsers   = ["all", ...new Set(runLog.map(r=>r.user))];
  const allProjects= ["all", ...new Set(runLog.map(r=>r.project).filter(Boolean))];

  const filtered = runLog.filter(r =>
    (filterTool==="all" || r.toolKey===filterTool) &&
    (filterUser==="all" || r.user===filterUser) &&
    (filterProj==="all" || r.project===filterProj)
  );

  const sel = { padding:"7px 11px", border:`1px solid ${C.border}`, borderRadius:7, fontSize:12.5, fontFamily:"'DM Sans',sans-serif", color:C.textMid, background:C.surface, cursor:"pointer", outline:"none" };

  return (
    <div className="fade">
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:28 }}>
        <div>
          <h1 style={{ fontFamily:"'Lora',serif", fontSize:25, fontWeight:600, color:C.navy, lineHeight:1.2 }}>Admin</h1>
          <p style={{ fontSize:13, color:C.textMuted, marginTop:4 }}>Usage log and tool status management</p>
        </div>
      </div>

      {/* Tool status controls */}
      <p style={{ fontSize:10.5, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>Tool Status</p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:28 }}>
        {TOOL_DEFS.map(tool => {
          const status = toolStatuses[tool.key];
          return (
            <div key={tool.key} style={{ ...card, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:12 }}>
                <div style={{ width:30, height:30, borderRadius:7, background:C.navy, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <Icon name={tool.icon} size={14} color={C.goldBright} />
                </div>
                <span style={{ fontSize:12.5, fontWeight:600, color:C.navy, lineHeight:1.3 }}>{tool.name}</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {["operational","maintenance","degraded"].map(s => (
                  <label key={s} onClick={()=>setToolStatuses(prev=>({...prev,[tool.key]:s}))}
                    style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:6, border:`1px solid ${status===s?STATUS_META[s].color:C.border}`, background:status===s?STATUS_META[s].bg:"transparent", cursor:"pointer", transition:"all .15s" }}>
                    <div style={{ width:14, height:14, borderRadius:"50%", border:`2px solid ${status===s?STATUS_META[s].color:C.border}`, background:status===s?STATUS_META[s].color:"transparent", flexShrink:0 }} />
                    <span style={{ fontSize:11.5, fontWeight:status===s?600:400, color:status===s?STATUS_META[s].color:C.textMuted, textTransform:"capitalize" }}>{s}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Run log */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <p style={{ fontSize:10.5, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase" }}>
          Run Log <span style={{ fontSize:10, color:C.textFaint, fontWeight:400, textTransform:"none", letterSpacing:0 }}>({filtered.length} entries)</span>
        </p>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <Icon name="filter" size={13} color={C.textMuted} />
          <select value={filterTool} onChange={e=>setFilterTool(e.target.value)} style={sel}>
            {allTools.map(t=><option key={t} value={t}>{t==="all"?"All Tools":TOOL_DEFS.find(d=>d.key===t)?.name||t}</option>)}
          </select>
          <select value={filterUser} onChange={e=>setFilterUser(e.target.value)} style={sel}>
            {allUsers.map(u=><option key={u} value={u}>{u==="all"?"All Users":u}</option>)}
          </select>
          <select value={filterProj} onChange={e=>setFilterProj(e.target.value)} style={sel}>
            {allProjects.map(p=><option key={p} value={p}>{p==="all"?"All Projects":p}</option>)}
          </select>
        </div>
      </div>

      <div style={{ ...card, padding:0, overflow:"hidden" }}>
        {/* Header */}
        <div style={{ display:"grid", gridTemplateColumns:"2fr 1.4fr 1.6fr 1fr 1.1fr", gap:0, padding:"10px 18px", background:C.bg, borderBottom:`1px solid ${C.border}` }}>
          {["Tool","Analysis Type","Project / Client","User","Date & Time"].map(h=>(
            <span key={h} style={{ fontSize:10, fontWeight:600, color:C.textFaint, letterSpacing:"0.08em", textTransform:"uppercase" }}>{h}</span>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding:"32px", textAlign:"center", color:C.textFaint, fontSize:13 }}>No entries match the current filters.</div>
        ) : (
          filtered.map((run, i) => (
            <div key={run.id} style={{ display:"grid", gridTemplateColumns:"2fr 1.4fr 1.6fr 1fr 1.1fr", gap:0, padding:"12px 18px", borderBottom:i<filtered.length-1?`1px solid ${C.borderLight}`:"none", alignItems:"center" }}>
              <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                <div style={{ width:28, height:28, borderRadius:7, background:C.navy, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <Icon name={run.toolKey} size={13} color={C.goldBright} />
                </div>
                <span style={{ fontSize:12.5, fontWeight:500, color:C.text }}>{run.tool}</span>
              </div>
              <div>
                {run.type!=="—"
                  ? <span style={badge(TAG_COLORS[run.toolKey]||{})}>{run.type}</span>
                  : <span style={{ fontSize:12, color:C.textFaint }}>—</span>}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {run.project
                  ? <><Icon name="tag" size={12} color={C.textFaint} /><span style={{ fontSize:12.5, color:C.textMid }}>{run.project}</span></>
                  : <span style={{ fontSize:12, color:C.textFaint, fontStyle:"italic" }}>No project set</span>}
              </div>
              <span style={{ fontSize:12.5, color:C.textMid }}>{run.user}</span>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <Icon name="clock" size={11} color={C.textFaint} />
                <div>
                  <span style={{ fontSize:12, color:C.textMid, display:"block" }}>{run.date}</span>
                  <span style={{ fontSize:11, color:C.textFaint }}>{run.time}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════════════
let nextId = SEED_LOG.length + 1;

export default function App() {
  const [page,       setPage]       = useState("dashboard");
  const [collapsed,  setCollapsed]  = useState(false);
  const [runLog,     setRunLog]     = useState(SEED_LOG);
  const [toolStatuses, setToolStatuses] = useState({
    entitlement: "operational",
    fp:          "operational",
    oracle:      "maintenance",
    sod:         "operational",
  });

  const onComplete = (entry) => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
    setRunLog(prev => [{ id:nextId++, ...entry, user:"Mohd Khizar", date:now.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}), time }, ...prev]);
  };

  const NAV = [
    { key:"dashboard",   label:"Dashboard",             icon:"dashboard"   },
    { key:"fp",          label:"FP Analysis",           icon:"fp"          },
    { key:"entitlement", label:"Entitlement Mapping",   icon:"entitlement" },
    { key:"oracle",      label:"Oracle Role Comparison",icon:"oracle"      },
    { key:"sod",         label:"SOD & SA Analysis",     icon:"sod"         },
  ];

  const TITLES = { dashboard:"Dashboard", entitlement:"Entitlement Mapping", fp:"FP Analysis", oracle:"Oracle Role Comparison", sod:"SOD & SA Analysis", admin:"Admin" };

  const W = collapsed ? 56 : 228;

  return (
    <>
      <style>{G}</style>
      <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:C.bg }}>

        {/* ── Sidebar ── */}
        <aside style={{ width:W, minWidth:W, background:C.surface, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden", transition:"width .22s ease, min-width .22s ease" }}>

          {/* Logo */}
          <div style={{ padding:collapsed?"14px 0":"18px 18px 14px", borderBottom:`1px solid ${C.borderLight}`, display:"flex", flexDirection:"column", alignItems:collapsed?"center":"flex-start" }}>
            <div style={{ width:34, height:34, background:C.navy, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:collapsed?0:9, flexShrink:0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.goldBright} strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            {!collapsed && (
              <>
                <p style={{ fontFamily:"'Lora',serif", fontSize:12.5, fontWeight:600, color:C.navy }}>Access Governance</p>
                <p style={{ fontSize:9.5, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", marginTop:1 }}>Platform · Enterprise</p>
              </>
            )}
          </div>

          {/* Nav */}
          <div style={{ padding:collapsed?"10px 6px 4px":"12px 10px 4px", flex:1, overflow:"hidden" }}>
            {!collapsed && (
              <p style={{ fontSize:9.5, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", padding:"0 7px", marginBottom:6 }}>Governance</p>
            )}
            {NAV.map(item => {
              const active = page===item.key;
              const disabled = item.key!=="dashboard" && toolStatuses[item.key]==="maintenance";
              return (
                <div key={item.key}
                  onClick={()=>!disabled&&setPage(item.key)}
                  title={collapsed?item.label:undefined}
                  style={{ display:"flex", alignItems:"center", gap:collapsed?0:8, padding:collapsed?"8px":"7px 9px", justifyContent:collapsed?"center":"flex-start", borderRadius:7, cursor:disabled?"not-allowed":"pointer", marginBottom:2, background:active?C.goldLight:"transparent", border:active?`1px solid #E8C84D`:"1px solid transparent", transition:"all .15s", opacity:disabled?0.45:1 }}>
                  <div style={{ width:26, height:26, borderRadius:6, background:active?C.gold:C.surfaceAlt, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Icon name={item.icon} size={13} color={active?"#fff":C.textMuted} />
                  </div>
                  {!collapsed && <span style={{ fontSize:12.5, fontWeight:active?600:400, color:active?C.navy:C.textMid, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.label}</span>}
                </div>
              );
            })}

            {/* Admin nav item — separated */}
            <div style={{ margin:`${collapsed?8:12}px ${collapsed?0:0}px 0`, borderTop:`1px solid ${C.borderLight}`, paddingTop:8 }}>
              {!collapsed && (
                <p style={{ fontSize:9.5, fontWeight:600, color:C.textFaint, letterSpacing:"0.1em", textTransform:"uppercase", padding:"0 7px", marginBottom:6 }}>Admin</p>
              )}
              <div onClick={()=>setPage("admin")} title={collapsed?"Admin":undefined}
                style={{ display:"flex", alignItems:"center", gap:collapsed?0:8, padding:collapsed?"8px":"7px 9px", justifyContent:collapsed?"center":"flex-start", borderRadius:7, cursor:"pointer", background:page==="admin"?C.goldLight:"transparent", border:page==="admin"?`1px solid #E8C84D`:"1px solid transparent", transition:"all .15s" }}>
                <div style={{ width:26, height:26, borderRadius:6, background:page==="admin"?C.gold:C.surfaceAlt, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <Icon name="admin" size={13} color={page==="admin"?"#fff":C.textMuted} />
                </div>
                {!collapsed && <span style={{ fontSize:12.5, fontWeight:page==="admin"?600:400, color:page==="admin"?C.navy:C.textMid }}>Admin</span>}
              </div>
            </div>
          </div>

          {/* Bottom: badges + user + collapse toggle */}
          <div style={{ padding:collapsed?"8px 6px":"10px", borderTop:`1px solid ${C.borderLight}` }}>
            {!collapsed && (
              <div style={{ display:"flex", gap:5, marginBottom:9 }}>
                {[["TLS 1.3",C.greenBg,C.green],["SOC2",C.blueBg,C.blue]].map(([label,bg,color])=>(
                  <span key={label} style={{ ...badge({ background:bg, color }), fontSize:9 }}>
                    <Icon name="lock" size={8} color={color} />&nbsp;{label}
                  </span>
                ))}
              </div>
            )}
            {!collapsed && (
              <div style={{ display:"flex", alignItems:"center", gap:9, padding:"7px 9px", borderRadius:7, background:C.surfaceAlt, marginBottom:8 }}>
                <div style={{ width:30, height:30, borderRadius:"50%", background:C.navy, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:C.goldBright, flexShrink:0 }}>MK</div>
                <div>
                  <p style={{ fontSize:12, fontWeight:600, color:C.navy }}>Mohd Khizar</p>
                  <p style={{ fontSize:10, color:C.textFaint }}>EY · Analyst</p>
                </div>
              </div>
            )}
            {collapsed && (
              <div style={{ width:30, height:30, borderRadius:"50%", background:C.navy, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:C.goldBright, margin:"0 auto 8px" }}>MK</div>
            )}
            {/* Collapse toggle */}
            <button onClick={()=>setCollapsed(o=>!o)}
              style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:collapsed?"center":"flex-start", gap:7, padding:collapsed?"7px":"7px 9px", borderRadius:7, border:`1px solid ${C.border}`, background:"transparent", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", color:C.textMuted, fontSize:12, transition:"background .15s" }}
              onMouseOver={e=>e.currentTarget.style.background=C.bg}
              onMouseOut={e=>e.currentTarget.style.background="transparent"}>
              <Icon name={collapsed?"chevronRight":"chevron"} size={14} color={C.textMuted} style={{ transform:collapsed?"rotate(0)":"rotate(90deg)" }} />
              {!collapsed && <span>Collapse sidebar</span>}
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ flex:1, overflow:"auto", display:"flex", flexDirection:"column" }}>
          <div style={{ height:52, background:C.surface, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", padding:"0 28px", flexShrink:0 }}>
            <span style={{ fontSize:13, fontWeight:600, color:C.navy }}>{TITLES[page]}</span>
            <span style={{ marginLeft:"auto", fontSize:11.5, color:C.textFaint }}>{TODAY_LABEL}</span>
          </div>
          <div style={{ flex:1, padding:"28px 32px", overflow:"auto" }}>
            {page==="dashboard"   && <Dashboard   navigate={setPage} toolStatuses={toolStatuses} />}
            {page==="entitlement" && <EntitlementMapping onComplete={onComplete} />}
            {page==="fp"          && <FPAnalysis         onComplete={onComplete} />}
            {page==="oracle"      && <OracleComparator   onComplete={onComplete} />}
            {page==="sod"         && <SODAnalysis        onComplete={onComplete} />}
            {page==="admin"       && <AdminPage runLog={runLog} toolStatuses={toolStatuses} setToolStatuses={setToolStatuses} />}
          </div>
        </main>

      </div>
    </>
  );
}
