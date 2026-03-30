'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Map,
  Car,
  Bell,
  BarChart3,
  Hexagon,
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

const navItems = [
  { href: '/', label: 'Mapa', icon: Map },
  { href: '/vehicles', label: 'Veículos', icon: Car },
  { href: '#', label: 'Alertas', icon: Bell, disabled: true },
  { href: '#', label: 'Relatórios', icon: BarChart3, disabled: true },
  { href: '#', label: 'Geofencing', icon: Hexagon, disabled: true },
  { href: '#', label: 'Configurações', icon: Settings, disabled: true },
];

function NavContent({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-2">
      {navItems.map((item) => {
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const ItemIcon = item.icon;

        const link = (
          <Link
            key={item.href}
            href={item.disabled ? '#' : item.href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
              isActive
                ? 'bg-emerald-500/10 text-emerald-400 border-l-2 border-emerald-400'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              item.disabled && 'opacity-40 pointer-events-none',
              collapsed && 'justify-center px-2',
            )}
          >
            <ItemIcon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );

        if (collapsed) {
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger render={<div />}>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        }

        return link;
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
