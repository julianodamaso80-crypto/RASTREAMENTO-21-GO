'use client';

import { LogOut, User as UserIcon } from 'lucide-react';
import { AlertsDropdown } from '@/components/alerts/alerts-dropdown';
import { AssistantDrawer } from '@/components/assistant/assistant-drawer';
import { BuscaGlobal } from '@/components/layout/busca-global';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  VIEWER: 'Visualizador',
  CLIENT: 'Cliente',
};

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="h-16 bg-[#293c82] border-b border-white/5 flex items-center justify-between gap-4 px-4 md:px-6">
      <div className="hidden md:flex items-center gap-3 min-w-0">
        <span className="text-sm text-slate-400 truncate">
          {user?.tenant?.name || '21Go! Proteção Veicular'}
        </span>
      </div>

      <BuscaGlobal />

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
