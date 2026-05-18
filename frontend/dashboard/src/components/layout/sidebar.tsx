'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import {
  LayoutDashboard,
  Map,
  Smartphone,
  Bell,
  BarChart3,
  Hexagon,
  Radio,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  Tag,
  Wrench,
  Trophy,
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
  // Quando definido, item só aparece pra users cujo role esteja na lista.
  // Sem `roles`, o item aparece pra todos os roles autenticados.
  roles?: Array<'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'CLIENT'>;
};

// Pra CLIENT (dono do veículo), só fazem sentido: Mapa do(s) próprio(s)
// veículo(s), Alertas (recebe quando algo acontece com ele), Relatórios.
// Itens administrativos ficam ocultos.
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
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { href: '/relatorios/condutores', label: 'Ranking de condutores', icon: Trophy, roles: NON_CLIENT_ROLES },
  { href: '/manutencao', label: 'Manutenção', icon: Wrench, roles: NON_CLIENT_ROLES },
  { href: '/geofencing', label: 'Geofencing', icon: Hexagon, roles: NON_CLIENT_ROLES },
  { href: '/dispositivos', label: 'Dispositivos', icon: Radio, roles: NON_CLIENT_ROLES },
  { href: '/etiquetas-ble', label: 'Etiquetas BLE', icon: Tag, roles: NON_CLIENT_ROLES },
  { href: '/chips', label: 'Chips M2M', icon: Smartphone, roles: NON_CLIENT_ROLES },
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
    <nav className="flex flex-col gap-1 px-2">
      {visibleItems.map((item) => {
        const isActive =
          item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
        const ItemIcon = item.icon;

        const classes = cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-brand-orange-500/10 text-brand-orange-500 border-l-2 border-brand-orange-500'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          item.disabled && 'opacity-40 cursor-not-allowed',
          collapsed && 'justify-center px-2',
        );

        const content = (
          <>
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

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col glass-light h-full transition-all duration-200',
          collapsed ? 'w-16' : 'w-[280px]',
        )}
      >
        <div className={cn('flex items-center gap-3 px-4 h-14', collapsed && 'justify-center px-2')}>
          {!collapsed && (
            <div className="flex flex-col leading-none">
              <span className="text-xl font-extrabold tracking-tight text-slate-50">
                21<span className="text-brand-orange-500">Go!</span>
              </span>
              <span className="text-[10px] font-semibold tracking-[0.15em] text-slate-400 uppercase">
                Proteção Veicular
              </span>
            </div>
          )}
          {collapsed && (
            <span className="text-base font-extrabold tracking-tight text-slate-50">
              21<span className="text-brand-orange-500">!</span>
            </span>
          )}
        </div>
        <div className="flex-1 py-2">
          <NavContent collapsed={collapsed} />
        </div>
        <div className="p-2 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full justify-center text-muted-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet>
        <SheetTrigger className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-md hover:bg-muted/50 transition-colors">
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] glass p-0">
          <div className="flex items-center gap-2 px-4 h-14 border-b border-border/50">
            <div className="flex flex-col leading-none">
              <span className="text-xl font-extrabold tracking-tight text-slate-50">
                21<span className="text-brand-orange-500">Go!</span>
              </span>
              <span className="text-[10px] font-semibold tracking-[0.15em] text-slate-400 uppercase">
                Proteção Veicular
              </span>
            </div>
          </div>
          <div className="py-4">
            <NavContent collapsed={false} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
