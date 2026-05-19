'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Search, User as UserIcon } from 'lucide-react';
import { AlertsDropdown } from '@/components/alerts/alerts-dropdown';
import { AssistantDrawer } from '@/components/assistant/assistant-drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';
import { useTracking } from '@/contexts/tracking-context';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  VIEWER: 'Visualizador',
  CLIENT: 'Cliente',
};

export function Header() {
  const { user, logout } = useAuth();
  const { setSearchQuery, filteredVehicles } = useTracking();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setSearchQuery(value.trim());
    router.push('/mapa');
  };

  // Tenta achar uma placa exata pra dar feedback rápido (não obrigatório)
  const hint =
    value.length >= 2 && filteredVehicles.length > 0
      ? `${filteredVehicles.length} veículo${filteredVehicles.length === 1 ? '' : 's'}`
      : null;

  return (
    <header className="h-16 bg-[#293c82] border-b border-white/5 flex items-center justify-between gap-4 px-4 md:px-6">
      <div className="hidden md:flex items-center gap-3 min-w-0">
        <span className="text-sm text-slate-400 truncate">
          {user?.tenant?.name || '21Go! Proteção Veicular'}
        </span>
      </div>

      <form onSubmit={onSubmit} className="flex-1 max-w-xl mx-auto">
        <div className="relative">
          <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Buscar veículo, placa, motorista…"
            className={cn(
              'w-full h-10 pl-10 pr-20 rounded-lg text-sm',
              'bg-[#1f2d63] text-slate-100 placeholder:text-slate-500',
              'border border-white/5',
              'focus:outline-none focus:border-brand-orange-500 focus:ring-2 focus:ring-brand-orange-500/20',
              'transition-colors',
            )}
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-[10px] font-semibold text-slate-500">
            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">{isMac ? '⌘' : 'Ctrl'}</span>
            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">K</span>
          </kbd>
          {hint && (
            <span className="absolute -bottom-5 left-3 text-[10px] text-slate-500">{hint}</span>
          )}
        </div>
      </form>

      <div className="flex items-center gap-2 shrink-0">
        <AssistantDrawer />
        <AlertsDropdown />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-lg hover:bg-white/5 transition-colors">
            <div className="w-9 h-9 rounded-full bg-brand-orange-500/15 ring-1 ring-brand-orange-500/30 flex items-center justify-center">
              <UserIcon className="h-4 w-4 text-brand-orange-500" />
            </div>
            <div className="hidden md:flex flex-col items-start leading-tight">
              <span className="text-sm font-semibold text-slate-100">{user?.name || ''}</span>
              <span className="text-[10px] text-slate-400">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-red-400 cursor-pointer">
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
