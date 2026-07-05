import { Navigate, useLocation } from "react-router-dom";
import useAuthStore from "../../store/auth.store";

export function RouteGuard({ children, onboardingExempt = false }) {
  const { status, activeWorkspace } = useAuthStore();
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
