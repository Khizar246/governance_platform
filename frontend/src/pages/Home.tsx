import { useNavigate } from 'react-router-dom'
import { Link, Target, Search, Shield, type LucideIcon } from 'lucide-react'
import { ROUTES } from '../utils/constants'

interface ToolCard {
  route: string
  icon: LucideIcon
  title: string
  description: string
  accentClass: string
  iconColorClass: string
}

const TOOLS: ToolCard[] = [
  {
    route: ROUTES.ENTITLEMENT_MAPPING,
    icon: Link,
    title: 'Entitlement Mapping',
    description:
      'Map client entitlements to EY rulesets using privilege overlap, Jaccard similarity, and name matching.',
    accentClass: 'border-l-ey-yellow',
    iconColorClass: 'text-ey-yellow',
  },
  {
    route: ROUTES.FP_ANALYSIS,
    icon: Target,
    title: 'False Positive Analysis',
    description:
      '3-level FP classification (False Positive · Single Leg · True Conflict) at privilege or entitlement level.',
    accentClass: 'border-l-info',
    iconColorClass: 'text-info',
  },
  {
    route: ROUTES.ORACLE_COMPARATOR,
    icon: Search,
    title: 'Oracle Comparator',
    description:
      'Compare duty roles, privileges, and data security policies across two Oracle environments using native set operations.',
    accentClass: 'border-l-success',
    iconColorClass: 'text-success',
  },
  {
    route: ROUTES.SOD_SA,
    icon: Shield,
    title: 'SOD & SA Analysis',
    description:
      'Segregation of Duties and Sensitive Access violation detection at role and user level with chunked processing.',
    accentClass: 'border-l-warning',
    iconColorClass: 'text-warning',
  },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-800">Welcome to EY Access Governance Platform</h1>
        <p className="text-sm text-gray-500 mt-1">Select a tool to begin your analysis</p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {TOOLS.map(({ route, icon: Icon, title, description, accentClass, iconColorClass }) => (
          <div
            key={route}
            className={`flex flex-col bg-white border border-gray-300 border-l-[3px] ${accentClass} rounded shadow-card hover:shadow-card-hover transition-shadow duration-200 p-5 cursor-pointer`}
            onClick={() => navigate(route)}
          >
            <div className={`mb-3 ${iconColorClass}`}>
              <Icon size={32} strokeWidth={1.5} />
            </div>
            <h2 className="text-base font-semibold text-gray-800 mb-2">{title}</h2>
            <p className="text-[13px] text-gray-500 leading-relaxed line-clamp-3">{description}</p>
            <button
              className="mt-auto pt-3 text-sm text-gray-400 hover:text-ey-yellow transition-colors duration-150 inline-flex items-center gap-1 self-start"
              onClick={(e) => { e.stopPropagation(); navigate(route) }}
            >
              Open →
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
