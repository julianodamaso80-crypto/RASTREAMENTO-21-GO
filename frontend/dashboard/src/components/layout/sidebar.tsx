'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const navItems: { href: string; label: string; icon: any; disabled?: boolean }[] = [
  { href: '/', label: 'Mapa / Veículos', icon: Map },
  { href: '/alertas', label: 'Alertas', icon: Bell },
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { href: '/geofencing', label: 'Geofencing', icon: Hexagon },
  { href: '/dispositivos', label: 'Dispositivos', icon: Radio },
  { href: '/chips', label: 'Chips M2M', icon: Smartphone },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];

function NavContent({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-2">
      {navItems.map((item) => {
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const ItemIcon = item.icon;

        const classes = cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-400'
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
        <div className={cn('flex items-center gap-2 px-4 h-14', collapsed && 'justify-center px-2')}>
          {!collapsed && (
            <span className="text-lg font-bold text-emerald-400">21 GO</span>
          )}
          {collapsed && (
            <span className="text-sm font-bold text-emerald-400">21</span>
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
            <span className="text-lg font-bold text-emerald-400">21 GO Rastreamento</span>
          </div>
          <div className="py-4">
            <NavContent collapsed={false} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
