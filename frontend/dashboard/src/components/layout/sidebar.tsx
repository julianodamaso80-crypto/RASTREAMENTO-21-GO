'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import {
  LayoutDashboard,
  Map,
  Bell,
  Radio,
  Boxes,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  Wrench,
  Trophy,
  ArrowRight,
  HardHat,
  ClipboardList,
  Route,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type NavItem = {
  href: string;
  label: string;
  icon: any;
  disabled?: boolean;
  roles?: Array<'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'CLIENT'>;
};

const NON_CLIENT_ROLES: NonNullable<NavItem['roles']> = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATOR',
  'VIEWER',
];

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: NON_CLIENT_ROLES },
  { href: '/mapa', label: 'Mapa / Veículos', icon: Map },
  { href: '/alertas', label: 'Alertas', icon: Bell },
  { href: '/relatorios/condutores', label: 'Ranking de condutores', icon: Trophy, roles: NON_CLIENT_ROLES },
  { href: '/manutencao', label: 'Manutenção', icon: Wrench, roles: NON_CLIENT_ROLES },
  { href: '/dispositivos', label: 'Dispositivos', icon: Radio, roles: NON_CLIENT_ROLES },
  { href: '/estoque', label: 'Estoque', icon: Boxes, roles: NON_CLIENT_ROLES },
  { href: '/clientes', label: 'Clientes Ativos', icon: Users, roles: NON_CLIENT_ROLES },
  { href: '/pendencias', label: 'Pendentes de Instalação', icon: ClipboardList, roles: NON_CLIENT_ROLES },
  { href: '/rotas', label: 'Rota Inteligente', icon: Route, roles: NON_CLIENT_ROLES },
  { href: '/tecnicos', label: 'Técnicos', icon: HardHat, roles: NON_CLIENT_ROLES },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];

function NavContent({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.role;
  const visibleItems = navItems.filter(
    (item) => !item.roles || (role && item.roles.includes(role)),
  );

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {!collapsed && (
        <span className="px-3 pt-1 pb-2 text-[10px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
          Menu Principal
        </span>
      )}
      {visibleItems.map((item) => {
        const isActive =
          item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
        const ItemIcon = item.icon;

        const classes = cn(
          'relative flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors duration-200',
          isActive
            ? 'bg-brand-orange-500/10 text-brand-orange-500'
            : 'text-slate-400 hover:text-slate-100 hover:bg-white/5',
          item.disabled && 'opacity-40 cursor-not-allowed',
          collapsed && 'justify-center px-2',
        );

        const content = (
          <>
            {isActive && !collapsed && (
              <span
                aria-hidden
                className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-sm bg-brand-orange-500"
              />
            )}
            <ItemIcon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </>
        );

        const element = item.disabled ? (
          <span key={item.label} className={classes}>{content}</span>
        ) : (
          <Link key={item.label} href={item.href} className={classes}>{content}</Link>
        );

        if (collapsed) {
          return (
            <Tooltip key={item.label}>
              <TooltipTrigger render={<div />}>{element}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        }

        return element;
      })}
    </nav>
  );
}

function BrandHeader({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 h-16 border-b border-white/5',
        collapsed ? 'justify-center px-2' : 'px-5',
      )}
    >
      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-brand-orange-500/15 ring-1 ring-brand-orange-500/30">
        <Image
          src="/logo-21go.png"
          alt="21 GO"
          fill
          sizes="36px"
          className="object-contain p-1"
          priority
        />
      </div>
      {!collapsed && (
        <div className="flex flex-col leading-tight">
          <span className="text-base font-extrabold tracking-tight text-slate-50">
            21<span className="text-brand-orange-500">Go!</span>
          </span>
          <span className="text-[10px] font-semibold tracking-[0.15em] text-slate-400 uppercase">
            Proteção Veicular
          </span>
        </div>
      )}
    </div>
  );
}

function ProPromo() {
  return (
    <div className="mx-3 mb-3 rounded-xl bg-gradient-to-br from-brand-orange-500/15 via-brand-orange-500/5 to-transparent border border-brand-orange-500/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-orange-500">
          Plano Pro
        </span>
        <span className="text-[10px] text-slate-400 tabular-nums">75%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden mb-2">
        <div className="h-full rounded-full bg-brand-orange-500 transition-all" style={{ width: '75%' }} />
      </div>
      <Link
        href="/configuracoes"
        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-brand-orange-400 transition-colors"
      >
        Ver detalhes <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col bg-[#293c82] h-full transition-all duration-200 border-r border-white/5',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <BrandHeader collapsed={collapsed} />
        <div className="flex-1 py-4 overflow-y-auto">
          <NavContent collapsed={collapsed} />
        </div>
        {!collapsed && <ProPromo />}
        <div className="p-2 border-t border-white/5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full justify-center text-slate-400 hover:text-slate-100 hover:bg-white/5"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet>
        <SheetTrigger className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-[#293c82] text-slate-100 hover:bg-[#1f2d63] transition-colors">
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-[#293c82] border-r border-white/5 p-0">
          <BrandHeader collapsed={false} />
          <div className="py-4">
            <NavContent collapsed={false} />
          </div>
          <ProPromo />
        </SheetContent>
      </Sheet>
    </>
  );
}
