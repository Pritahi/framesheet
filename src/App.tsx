import { useEffect, useRef, useState } from "react";
import { Combine, FileVideo, Keyboard } from "lucide-react";
import { studio, useStudioVersion } from "./store";
import { DetectionRunner } from "./engine/runner";
import { HeaderBar } from "./components/HeaderBar";
import { Stage } from "./components/Stage";
import { Timeline } from "./components/Timeline";
import { ZonePanel } from "./components/ZonePanel";
import { SummarySheet } from "./components/SummarySheet";
import { EventLog } from "./components/EventLog";
import { Toasts } from "./components/Toasts";
import { HelpModal } from "./components/HelpModal";

export default function App() {
  useStudioVersion();
  const [dragOver, setDragOver] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const dragDepth = useRef(0);

  /* boot: default scenario + detection runner + keyboard bus */
  useEffect(() => {
    // debug handle for automation & field diagnostics
    (window as unknown as { __fs: typeof studio }).__fs = studio;
    studio.initScenario("retail");
    const runner = new DetectionRunner(studio);
    runner.start();
    const autoplay = window.setTimeout(() => studio.source?.play(), 600);

    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (el?.isContentEditable) return;
      const t = studio.source?.currentTime ?? 0;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          studio.source?.toggle();
          break;
        case "KeyI":
          studio.markStart();
          break;
        case "KeyO":
          studio.markEnd();
          break;
        case "ArrowLeft":
          studio.requestSeek(t - 5);
          break;
        case "ArrowRight":
          studio.requestSeek(t + 5);
          break;
        case "KeyN":
          studio.setInteractionMode(studio.interactionMode === "draw" ? "select" : "draw");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      runner.stop();
      window.clearTimeout(autoplay);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /* drag & drop video upload */
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current++;
      setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (/video\/(mp4|webm|ogg|quicktime)/.test(file.type) || /\.(mp4|webm|mov)$/i.test(file.name)) {
        studio.loadFile(file);
      } else {
        studio.toast("Unsupported file — drop an .mp4 or .webm video", "err");
      }
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-obsidian text-ink">
      <HeaderBar onHelp={() => setShowHelp(true)} />

      <main className="scroll-slim grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 2xl:grid-cols-[minmax(0,1fr)_470px]">
        {/* left: video stack */}
        <div className="flex min-h-0 flex-col gap-3">
          <Stage />
          <Timeline />
          <ZonePanel />
        </div>

        {/* right: spreadsheet stack */}
        <div className="flex min-h-[560px] flex-col gap-3 2xl:min-h-0">
          <SummarySheet />
          <EventLog />
        </div>
      </main>

      {/* footer */}
      <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-panel/80 px-3 font-mono text-[9px] uppercase tracking-[0.18em] text-dim">
        <span className="flex items-center gap-1.5">
          <Keyboard className="h-3 w-3 text-emerald-400/70" />
          space play · I/O manual mark · ←→ ±5s · N draw zone
        </span>
        <div className="flex-1" />
        <span className="hidden items-center gap-1.5 md:flex">
          <Combine className="h-3 w-3 text-purple-300/80" />
          frankenstein stitch: CV engine × formula sheet — one event log between them
        </span>
        <span className="hidden lg:block">.kiro/ spec-driven build</span>
      </footer>

      {/* drag overlay */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-obsidian/80 backdrop-blur-sm">
          <div className="zone-proof-banner flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-emerald-400/70 bg-panel px-10 py-8">
            <FileVideo className="h-8 w-8 text-emerald-300" />
            <div className="font-mono text-[12px] uppercase tracking-[0.24em] text-emerald-200">
              Drop video to load it on-device
            </div>
            <div className="font-mono text-[9px] text-dim">MP4 · WEBM — frames never leave this browser</div>
          </div>
        </div>
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <Toasts />
    </div>
  );
}
