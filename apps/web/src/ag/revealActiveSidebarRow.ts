// Ag fork (FORK.md): when a thread becomes the active one (switching sessions by keyboard, link, palette or
// notification), scroll the sidebar so its row is in view. The row's own active styling shows it as selected.
import { useCallback, useEffect, useRef, useState } from "react";

export function useRevealActiveSidebarRow(
  rowRef: (element: HTMLElement | null) => void,
  isActive: boolean,
): (element: HTMLElement | null) => void {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const wasActive = useRef(false);
  useEffect(() => {
    const becameActive = isActive && !wasActive.current;
    wasActive.current = isActive;
    if (becameActive && row) revealSidebarRow(row);
  }, [isActive, row]);
  return useCallback(
    (element: HTMLElement | null) => {
      setRow(element);
      rowRef(element);
    },
    [rowRef],
  );
}

export function revealSidebarRow(row: HTMLElement): void {
  // Wait a frame so a just-expanded group or freshly mounted row has its final position.
  requestAnimationFrame(() => {
    if (row.isConnected) row.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
