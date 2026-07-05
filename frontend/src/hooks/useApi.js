import { useState, useEffect, useCallback, useRef } from "react";

// Generic data fetching hook
// Returns { data, loading, error, refetch }
export function useApi(apiFn, deps = [], options = {}) {
  const { immediate = true, defaultData = null } = options;
  const [data, setData]       = useState(defaultData);
  const [loading, setLoading] = useState(immediate);
  const [error, setError]     = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFn();
      if (mountedRef.current) {
        setData(res.data.data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err);
        // Don't clear existing data on error — stale data is better than nothing
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, deps);

  useEffect(() => {
    if (immediate) fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

// Polling variant — refetches on interval
export function usePolling(apiFn, intervalMs = 30000, deps = []) {
  const result = useApi(apiFn, deps);
  const { refetch } = result;

  useEffect(() => {
    const timer = setInterval(refetch, intervalMs);
    return () => clearInterval(timer);
  }, [refetch, intervalMs]);

  return result;
}
