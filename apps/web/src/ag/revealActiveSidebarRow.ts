// Ag fork (FORK.md): when a thread becomes the active one (switching sessions by keyboard, link, palette or
// notification), scroll the sidebar so its row is centered. The row's own active styling shows it as selected.
import { useRef } from "react";

type RowRef = (element: HTMLElement | null) => (() => void) | undefined | void;

// Returns a fresh ref each render, so React re-runs it whenever isActive changes; it keeps no state (re-attaching
// never re-renders the row) and forwards the wrapped ref's cleanup.
export function useRevealActiveSidebarRow<R extends RowRef>(
  rowRef: R,
  isActive: boolean,
): (element: HTMLElement | null) => ReturnType<R> {
  const revealed = useRef(false);
  return (element) => {
    if (!isActive) {
      revealed.current = false;
    } else if (element && !revealed.current) {
      revealed.current = true;
      revealSidebarRow(element);
    }
    return rowRef(element) as ReturnType<R>;
  };
}

export function revealSidebarRow(row: HTMLElement): void {
  // Rows use content-visibility with estimated heights, so the layout shifts as rows scrolled past render.
  // Center the row on the next frame (a just-expanded group has its final position), then correct once settled.
  const reveal = () => {
    if (row.isConnected) row.scrollIntoView({ block: "center", inline: "nearest" });
  };
  requestAnimationFrame(reveal);
  setTimeout(reveal, 250);
}
