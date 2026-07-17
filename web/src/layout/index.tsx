import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import PCMenu from './pc/menu';
import MobileMenuDrawer from './mobile/menu-drawer';
import MobileHeader from './mobile/mobile-header';

import { useAuthStore } from '@/store/auth';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export default function Layout() {
  const { isValidateToken } = useAuthStore();
  const isMobile = useIsMobile();
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const showMobileChrome = isMobile && isValidateToken && !isLoginPage;

  return (
    <div className="flex flex-col h-screen w-screen">
      {/* Main Layout with Sidebar */}
      <div className="flex flex-1 overflow-hidden bg-background">
        {/* PC Navigation menu */}
        {isValidateToken && !isLoginPage && !isMobile && <PCMenu />}

        {/* Mobile top bar: logo + menu */}
        {showMobileChrome && (
          <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />
        )}

        {/* Mobile Menu Drawer */}
        {isValidateToken && !isLoginPage && isMobile && (
          <MobileMenuDrawer
            open={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
          />
        )}

        <main
          className={cn(
            'flex-1 overflow-auto w-full relative bg-background',
            showMobileChrome
              && 'mt-[calc(3.5rem+env(safe-area-inset-top,0px))] h-[calc(100dvh-(3.5rem+env(safe-area-inset-top,0px)))]'
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
