'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import {
  canAccessRoute,
  firstAllowedPath,
  routeKeyForPath,
} from '@/lib/manageable-routes';
import { TrackingProvider } from '@/contexts/tracking-context';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { StatusBar } from '@/components/layout/status-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { VerificarWhatsappDialog } from '@/components/auth/verificar-whatsapp-dialog';
import { authApi } from '@/lib/api';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading, logout, refreshUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // Tela não liberada pro usuário: entrar pela URL também não passa.
  useEffect(() => {
    if (isLoading || !user) return;
    const route = routeKeyForPath(pathname);
    if (route && !canAccessRoute(route, user.role, user.allowedRoutes)) {
      router.replace(firstAllowedPath(user.role, user.allowedRoutes));
    }
  }, [isLoading, user, pathname, router]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Skeleton className="h-12 w-12 rounded-xl mx-auto" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  // Sem WhatsApp confirmado não se navega: é esse número que recebe o código
  // quando a pessoa esquecer a senha. Quem decide é o backend — com o canal de
  // envio desligado a exigência não vale, senão o popup tranca todo mundo do
  // lado de fora sem ter como receber o código.
  if (user && user.phoneVerificationRequired) {
    return (
      <VerificarWhatsappDialog
        nome={user.name?.split(' ')[0]}
        iniciar={authApi.startPhone}
        confirmar={authApi.confirmPhone}
        onVerificado={refreshUser}
        onSair={logout}
      />
    );
  }

  return (
    <TrackingProvider>
      <div className="h-screen flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main className="flex-1 overflow-hidden">{children}</main>
          <StatusBar />
        </div>
      </div>
    </TrackingProvider>
  );
}
