import { Navigate, useLocation } from "react-router-dom";
import useAuthStore from "../../store/auth.store";

export function RouteGuard({ children, onboardingExempt = false }) {
  const { status, activeWorkspace, user } = useAuthStore();
  const location = useLocation();

  if (status === "authenticating") {
    return (
      <div style={{
        minHeight: "100vh", background: "#0A0A0F",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        color: "#5A6478", letterSpacing: "0.06em",
      }}>
        Authenticating…
      </div>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Email verification gate — applies before onboarding too, since real
  // fund custody starts there. user.emailVerified is undefined for accounts
  // that pre-date this feature (treated as verified, not re-gated).
  if (user?.emailVerified === false && location.pathname !== "/verify-email") {
    return <Navigate to="/verify-email" replace />;
  }

  if (!onboardingExempt) {
    const onboarding = activeWorkspace?.settings?.onboarding;
  // If settings not loaded yet or onboarding key absent, don't gate
  const onboardingComplete = !onboarding || onboarding.complete === true;
    if (!onboardingComplete && location.pathname !== "/onboarding") {
      return <Navigate to="/onboarding" replace />;
    }
  }

  return children;
}
