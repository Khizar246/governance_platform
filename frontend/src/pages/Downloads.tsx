import PageHeader from '../components/layout/PageHeader'

interface DownloadItem {
  name: string
  description: string
  href: string
  filename: string
}

const DOWNLOADS: DownloadItem[] = [
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

export default function Downloads() {
  return (
    <div>
      <PageHeader
        icon={<IconDownload c="#FFD100" s={20} />}
        title="Downloads"
        subtitle="Download the standard EY Ruleset and FP Database used across the platform."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        {DOWNLOADS.map((item) => (
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
  )
}
