'use client';

import { LogOut, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertsDropdown } from '@/components/alerts/alerts-dropdown';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="h-14 glass-light flex items-center justify-between px-4 md:px-6">
      <div className="flex items-center gap-3">
        <span className="hidden md:block text-sm text-muted-foreground">
          {user?.tenant?.name || '21Go! Proteção Veicular'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <AlertsDropdown />

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 px-2 py-1.5 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors">
            <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <UserIcon className="h-4 w-4 text-emerald-400" />
            </div>
            <span className="hidden md:block text-sm">{user?.name || ''}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.role}</p>
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
