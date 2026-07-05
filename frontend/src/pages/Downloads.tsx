import { useState } from 'react'
import { ChevronDown, Download, FileSpreadsheet, GitMerge, Search, Shield, Info } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'

// ── Data ──────────────────────────────────────────────────────────────────

interface DownloadItem {
  name: string
  description: string
  href: string
  filename: string
}

const REFERENCE_FILES: DownloadItem[] = [
  {
    name: 'EY Ruleset',
    description: 'Standard SoD & SA ruleset (SoD Ruleset, SA Ruleset, Entitlement to Privilege, Bucket Details).',
    href: '/api/seeded/ruleset.xlsx',
    filename: 'ruleset.xlsx',
  },
  {
    name: 'FP Database',
    description: 'False-Positive database (No-action privileges and work-area privilege mappings).',
    href: '/api/seeded/fp_database.xlsx',
    filename: 'fp_database.xlsx',
  },
]

interface ToolTemplateGroup {
  tool: string
  accent: string
  icon: React.ReactNode
  description: string
  note?: string
  files: DownloadItem[]
}

const TEMPLATE_GROUPS: ToolTemplateGroup[] = [
  {
    tool: 'Ruleset Mapping',
    accent: '#7C3AED',
    icon: <GitMerge size={16} color="#7C3AED" />,
    description: 'Client and EY ruleset files for control mapping.',
    files: [
      {
        name: 'Client Ruleset Template',
        description: 'SoD Ruleset, SA Ruleset and Entitlement to Privilege sheets for the client side.',
        href: '/api/templates/ruleset-mapping/client_ruleset_template.xlsx',
        filename: 'client_ruleset_template.xlsx',
      },
      {
        name: 'EY Ruleset Template',
        description: 'Same 3 sheets as the client template, for the EY side of the mapping.',
        href: '/api/templates/ruleset-mapping/ey_ruleset_template.xlsx',
        filename: 'ey_ruleset_template.xlsx',
      },
    ],
  },
  {
    tool: 'Oracle Comparator',
    accent: '#16A34A',
    icon: <Search size={16} color="#16A34A" />,
    description: 'RBAC and DSP export formats for environment comparison.',
    note: 'These templates are for reference only. If you already have RBAC or DSP extracts from Oracle Fusion, you can upload them directly — no need to reformat them to match the template.',
    files: [
      {
        name: 'RBAC Export Template',
        description: 'Role name, entitlement and inherited role columns.',
        href: '/api/templates/oracle-comparator/rbac_template.xlsx',
        filename: 'rbac_template.xlsx',
      },
      {
        name: 'DSP Export Template',
        description: 'Data security policy columns (object, function, instance set, grant end date).',
        href: '/api/templates/oracle-comparator/dsp_template.xlsx',
        filename: 'dsp_template.xlsx',
      },
    ],
  },
  {
    tool: 'SOD & SA Analysis',
    accent: '#D97706',
    icon: <Shield size={16} color="#D97706" />,
    description: 'Input files for role-level and user-level SoD / SA analysis.',
    files: [
      {
        name: 'Role Hierarchy Template',
        description: 'Role-to-privilege hierarchy report. Always required.',
        href: '/api/templates/sod-sa-analysis/role_hierarchy_template.xlsx',
        filename: 'role_hierarchy_template.xlsx',
      },
      {
        name: 'SOD SA Ruleset Template',
        description: 'Standard 2-leg ruleset (LHS / RHS entitlements).',
        href: '/api/templates/sod-sa-analysis/ruleset_template.xlsx',
        filename: 'ruleset_template.xlsx',
      },
      {
        name: 'SOD SA Ruleset Template (3-Leg)',
        description: '3-leg ruleset with Entitlement 1–3 and AND/OR conditions.',
        href: '/api/templates/sod-sa-analysis/ruleset_template_3leg.xlsx',
        filename: 'ruleset_template_3leg.xlsx',
      },
      {
        name: 'User Role Membership Template',
        description: 'User-to-role assignments. Required for User-level analysis.',
        href: '/api/templates/sod-sa-analysis/user_roles_template.xlsx',
        filename: 'user_roles_template.xlsx',
      },
      {
        name: 'FP Database Template',
        description: 'False-Positive database format. Required when FP Detection is on.',
        href: '/api/templates/sod-sa-analysis/fp_database_template.xlsx',
        filename: 'fp_database_template.xlsx',
      },
    ],
  },
]

// ── Icons (page header / reference cards) ─────────────────────────────────

function IconFile({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function IconDownload({ c, s }: { c: string; s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke={c} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 10.5, fontWeight: 600, color: '#94A3B8',
          textTransform: 'uppercase', letterSpacing: '0.12em',
          marginBottom: 3,
        }}
      >
        {title}
      </div>
      <p style={{ fontSize: 12.5, color: '#64748B', lineHeight: 1.5 }}>{subtitle}</p>
    </div>
  )
}

function TemplateRow({ file, accent }: { file: DownloadItem; accent: string }) {
  return (
    <a
      href={file.href}
      download={file.filename}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '9px 12px', borderRadius: 8,
        border: '1px solid #E2E8F0',
        textDecoration: 'none',
        background: '#FFFFFF',
        transition: 'background 0.12s, border-color 0.12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#FFFBEB'
        e.currentTarget.style.borderColor = '#FFD100'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#FFFFFF'
        e.currentTarget.style.borderColor = '#E2E8F0'
      }}
    >
      <FileSpreadsheet size={16} color={accent} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>{file.name}</div>
        <div style={{ fontSize: 11.5, color: '#94A3B8', lineHeight: 1.4 }}>{file.description}</div>
      </div>
      <code
        style={{
          fontSize: 10, background: '#F0EFE9', padding: '2px 7px', borderRadius: 3,
          color: '#64748B', fontFamily: 'monospace', flexShrink: 0,
        }}
      >
        XLSX
      </code>
      <Download size={14} color="#0F1E3D" style={{ flexShrink: 0 }} />
    </a>
  )
}

function TemplateAccordion({ group }: { group: ToolTemplateGroup }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', background: '#FFFFFF' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px',
          background: open ? '#F7F6F3' : 'transparent',
          border: 'none', cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif",
          transition: 'background 0.15s',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            width: 34, height: 34, borderRadius: 8,
            background: group.accent + '15',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {group.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0F1E3D' }}>{group.tool}</div>
          <div style={{ fontSize: 11.5, color: '#94A3B8' }}>{group.description}</div>
        </div>
        <span
          style={{
            fontSize: 11, fontWeight: 600, color: '#64748B',
            background: '#F0EFE9', padding: '3px 9px', borderRadius: 999,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          {group.files.length} {group.files.length === 1 ? 'template' : 'templates'}
        </span>
        <ChevronDown
          size={16}
          color="#64748B"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.22s', flexShrink: 0 }}
        />
      </button>
      {open && (
        <div style={{ padding: '14px 16px 16px', borderTop: '1px solid #F1F0EA' }}>
          {group.note && (
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                marginBottom: 12, padding: '9px 12px', borderRadius: 7,
                background: '#F0F9FF', border: '1px solid #BAE6FD',
              }}
            >
              <Info size={13} color="#0369A1" style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: '#0369A1', lineHeight: 1.5 }}>{group.note}</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {group.files.map((file) => (
              <TemplateRow key={file.filename} file={file} accent={group.accent} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function Downloads() {
  return (
    <div>
      <PageHeader
        icon={<IconDownload c="#FFD100" s={20} />}
        title="Downloads"
        subtitle="One place for every file — standard EY reference files and blank templates for each tool."
      />

      {/* ── EY Reference Files ── */}
      <div style={{ marginBottom: 28 }}>
        <SectionHeader
          title="EY Reference Files"
          subtitle="Ready-to-use standard files maintained by EY — download and use them as-is."
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {REFERENCE_FILES.map((item) => (
            <div
              key={item.filename}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: 12,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40, height: 40,
                    borderRadius: 9,
                    background: '#F0EFE9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <IconFile c="#0F1E3D" s={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0F1E3D' }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>{item.filename}</div>
                </div>
              </div>

              <p style={{ fontSize: 12.5, color: '#64748B', lineHeight: 1.5, flex: 1 }}>{item.description}</p>

              <a
                href={item.href}
                download={item.filename}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '9px 14px',
                  borderRadius: 8,
                  background: '#0F1E3D',
                  color: '#FFD100',
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: 'none',
                  transition: 'background 0.13s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#16294F' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#0F1E3D' }}
              >
                <IconDownload c="#FFD100" s={15} /> Download
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tool Templates ── */}
      <div>
        <SectionHeader
          title="Tool Templates"
          subtitle={'Blank templates with the correct column headers and a "How to Fill Data" guide sheet pre-filled. Expand a tool to see its templates.'}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {TEMPLATE_GROUPS.map((group) => (
            <TemplateAccordion key={group.tool} group={group} />
          ))}
        </div>
      </div>
    </div>
  )
}
