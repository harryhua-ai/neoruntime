import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

interface AuthGuardProps {
  children: React.ReactNode;
}

const enableAuth = import.meta.env.VITE_ENABLE_AUTH === 'true';

export default function AuthGuard({ children }: AuthGuardProps) {
  const isValidateToken = useAuthStore(s => s.isValidateToken);
  const location = useLocation();

  if (!isValidateToken && enableAuth) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
