import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { RouteGuard } from "./components/auth/RouteGuard";
import { AppShell } from "./components/layout/AppShell";
import { useSocket } from "./hooks/useSocket";
import useAuthStore from "./store/auth.store";
import useSystemStore from "./store/system.store";
import { signals as signalsApi } from "./api/endpoints";

// Pages
import LoginPage    from "./pages/login/LoginPage";
import SignupPage   from "./pages/login/SignupPage";
import VerifyEmailPage from "./pages/verify-email/VerifyEmailPage";
import Dashboard    from "./pages/dashboard/Dashboard";
import Signals      from "./pages/signals/Signals";
import Proposals    from "./pages/proposals/Proposals";
import Positions    from "./pages/positions/Positions";
import Portfolio    from "./pages/portfolio/Portfolio";
import AuditLog     from "./pages/audit/AuditLog";
import Settings       from "./pages/settings/Settings";
import WalletConnect  from "./pages/wallets/WalletConnect";
import PnLDashboard  from "./pages/pnl/PnLDashboard";
import SubscribePage   from "./pages/subscribe/SubscribePage";
import OnboardingPage from "./pages/onboarding/OnboardingPage";
import AdminKycQueue from "./pages/admin/AdminKycQueue";

function AuthenticatedApp() {
  useSocket(); // Initialize WebSocket connection
  const { setRegime } = useSystemStore();

  // Bootstrap regime state on mount + poll every 5 minutes
  useEffect(() => {
    const fetchRegime = () => {
      signalsApi.regimeCurrent()
        .then(res => setRegime(res.data.data))
        .catch(() => {});
    };
    fetchRegime();
    const t = setInterval(fetchRegime, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <AppShell>
      <Routes>
        <Route path="/dashboard"  element={<Dashboard/>} />
        <Route path="/signals"    element={<Signals/>}   />
        <Route path="/proposals"  element={<Proposals/>} />
        <Route path="/positions"  element={<Positions/>} />
        <Route path="/portfolio"  element={<Portfolio/>} />
        <Route path="/audit"      element={<AuditLog/>}  />
        <Route path="/settings"   element={<Settings/>}  />
        <Route path="/wallets"   element={<WalletConnect/>} />
        <Route path="/pnl"      element={<PnLDashboard/>} />
        <Route path="/admin/kyc"  element={<AdminKycQueue/>} />
        <Route path="*"           element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    bootstrap();
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage/>} />
      <Route path="/signup" element={<SignupPage/>} />
      <Route path="/verify-email" element={<VerifyEmailPage/>} />
      <Route path="/subscribe" element={<SubscribePage/>} />
      <Route path="/onboarding" element={<RouteGuard onboardingExempt><OnboardingPage/></RouteGuard>} />
      <Route path="/unsubscribe" element={<SubscribePage/>} />
      <Route path="/*" element={
        <RouteGuard>
          <AuthenticatedApp/>
        </RouteGuard>
      }/>
    </Routes>
  );
}
