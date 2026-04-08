import { useCallback, useEffect, useRef, useState } from "react";

function formatTimestamp(date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function useDummyPageApi(pageKey) {
  const timerRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  const runFetch = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    setIsLoading(true);

    const delayMs = 420 + Math.floor(Math.random() * 480);
    timerRef.current = setTimeout(() => {
      setLastLoadedAt(new Date());
      setIsLoading(false);
      timerRef.current = null;
    }, delayMs);
  }, [pageKey]);

  useEffect(() => {
    runFetch();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [runFetch]);

  return {
    isLoading,
    lastLoadedAt,
    lastLoadedLabel: lastLoadedAt ? formatTimestamp(lastLoadedAt) : "--:--:--",
    refresh: runFetch,
  };
}
