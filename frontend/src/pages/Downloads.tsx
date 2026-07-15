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
  tintCls: string
  icon: React.ReactNode
  description: string
  note?: string
  files: DownloadItem[]
}

const TEMPLATE_GROUPS: ToolTemplateGroup[] = [
  {
    tool: 'Ruleset Mapping',
    accent: '#7C3AED',
    tintCls: 'bg-[#7C3AED15]',
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
    tintCls: 'bg-[#16A34A15]',
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
    tintCls: 'bg-[#D9770615]',
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
    <div className="mb-3">
      <div className="text-[10.5px] font-semibold text-[#94A3B8] uppercase tracking-[0.12em] mb-[3px]">
        {title}
      </div>
      <p className="text-[12.5px] text-[#64748B] leading-[1.5]">{subtitle}</p>
    </div>
  )
}

function TemplateRow({ file, accent }: { file: DownloadItem; accent: string }) {
  return (
    <a
      href={file.href}
      download={file.filename}
      className="flex items-center gap-[11px] px-3 py-[9px] rounded border border-[#E2E8F0] no-underline bg-white transition-[background,border-color] duration-[120ms]"
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#FFFBEB'
        e.currentTarget.style.borderColor = '#FFD100'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#FFFFFF'
        e.currentTarget.style.borderColor = '#E2E8F0'
      }}
    >
      <FileSpreadsheet size={16} color={accent} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#334155]">{file.name}</div>
        <div className="text-[11.5px] text-[#94A3B8] leading-[1.4]">{file.description}</div>
      </div>
      <code className="text-[10px] bg-[#F0EFE9] px-[7px] py-0.5 rounded-[3px] text-[#64748B] font-mono shrink-0">
        XLSX
      </code>
      <Download size={14} color="#0F1E3D" className="shrink-0" />
    </a>
  )
}

function TemplateAccordion({ group }: { group: ToolTemplateGroup }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-3 py-[14px] px-4 border-none cursor-pointer font-sans transition-colors duration-150 text-left ${open ? 'bg-[#F7F6F3]' : 'bg-transparent'}`}
      >
        <div className={`w-[34px] h-[34px] rounded flex items-center justify-center shrink-0 ${group.tintCls}`}>
          {group.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-[#0F1E3D]">{group.tool}</div>
          <div className="text-[11.5px] text-[#94A3B8]">{group.description}</div>
        </div>
        <span className="text-[11px] font-semibold text-[#64748B] bg-[#F0EFE9] px-[9px] py-[3px] rounded-full shrink-0 whitespace-nowrap">
          {group.files.length} {group.files.length === 1 ? 'template' : 'templates'}
        </span>
        <ChevronDown
          size={16}
          color="#64748B"
          className={`transition-transform duration-[220ms] shrink-0 ${open ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>
      {open && (
        <div className="pt-[14px] px-4 pb-4 border-t border-[#F1F0EA]">
          {group.note && (
            <div className="flex items-start gap-2 mb-3 px-3 py-[9px] rounded-[7px] bg-[#F0F9FF] border border-[#BAE6FD]">
              <Info size={13} color="#0369A1" className="mt-0.5 shrink-0" />
              <span className="text-[12.5px] text-[#0369A1] leading-[1.5]">{group.note}</span>
            </div>
          )}
          <div className="flex flex-col gap-2">
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
      <div className="mb-7">
        <SectionHeader
          title="EY Reference Files"
          subtitle="Ready-to-use standard files maintained by EY — download and use them as-is."
        />
        <div className="grid [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))] gap-4">
          {REFERENCE_FILES.map((item) => (
            <div
              key={item.filename}
              className="bg-white border border-[#E2E8F0] rounded-lg p-5 flex flex-col gap-[14px]"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[9px] bg-[#F0EFE9] flex items-center justify-center shrink-0">
                  <IconFile c="#0F1E3D" s={20} />
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[#0F1E3D]">{item.name}</div>
                  <div className="text-[11px] text-[#94A3B8] font-mono">{item.filename}</div>
                </div>
              </div>

              <p className="text-[12.5px] text-[#64748B] leading-[1.5] flex-1">{item.description}</p>

              <a
                href={item.href}
                download={item.filename}
                className="inline-flex items-center justify-center gap-2 px-[14px] py-[9px] rounded bg-[#0F1E3D] text-[#FFD100] text-[13px] font-semibold no-underline transition-colors duration-[130ms]"
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
        <div className="flex flex-col gap-2.5">
          {TEMPLATE_GROUPS.map((group) => (
            <TemplateAccordion key={group.tool} group={group} />
          ))}
        </div>
      </div>
    </div>
  )
}
