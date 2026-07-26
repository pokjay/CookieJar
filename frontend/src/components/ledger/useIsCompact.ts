"use client";

import { useEffect, useState } from "react";

/** True on phone-width viewports, where the ledger drops its secondary columns. */
export function useIsCompact(breakpoint = 700): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [breakpoint]);

  return compact;
}
