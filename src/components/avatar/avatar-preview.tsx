/* AvatarPreview — live 3D wrap with graceful degradation.

   Decides, at runtime, whether a real WebGL scene can run:
     - WebGL available + scene mounts cleanly  -> 3D avatar
     - otherwise -> a clean 2D fallback that still shows every
       selected garment fact (type, color, fit, note) so a user with no
       GPU support is never blocked.

   Gives the scene its view buttons (Front / Sides / Back / Reset) and
   an honest "structured preview" disclosure: the rendered garments are
   built from canonical product data, they are not an exact fit. */

"use client";

import {
  Component,
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { detectWebGL } from "@/lib/avatar/webgl";
import type { AvatarProfile } from "@/lib/avatar/profile";
import type { GarmentVisual } from "@/lib/outfit/garment";

const AvatarScene = lazy(() =>
  import("./avatar-scene").then((m) => ({ default: m.default }))
);

type PreviewProps = {
  profile: AvatarProfile;
  garments: GarmentVisual[];
  className?: string;
  style?: CSSProperties;
};

/* tiny boundary so a renderer crash cannot take the whole page down */
class SceneBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("avatar scene failed, using 2D fallback:", error);
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

function FallbackPanel({ garments }: { garments: GarmentVisual[] }) {
  return (
    <div className="grid h-full w-full place-items-center bg-paper-soft p-4">
      {garments.length === 0 ? (
        <p className="text-center text-sm text-ink-faint">
          Add pieces to see them on your model.
        </p>
      ) : (
        <div className="w-full max-w-md space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Garment view (2D)
          </p>
          {garments.map((g) => (
            <div
              key={`${g.slot}-${g.label}`}
              className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-5 w-5 rounded-full border border-ink/10"
                  style={{
                    backgroundColor: g.color?.hex ?? "#b9b4ac",
                  }}
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-semibold text-ink">{g.label}</p>
                  <p className="text-xs text-ink-soft">
                    {g.color?.name ?? "Multi"} ·{" "}
                    {g.fit !== "unknown" ? `${g.fit} fit` : "standard fit"}
                    {g.note ? ` · ${g.note}` : ""}
                  </p>
                </div>
              </div>
              <span className="text-xs text-ink-faint">{g.coverage}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const VIEWS: { id: "front" | "left" | "right" | "back"; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "back", label: "Back" },
];

function AvatarPreviewInner({
  profile,
  garments,
  className,
  style,
}: PreviewProps) {
  const [hasWebGL, setHasWebGL] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const sceneRef = useRef<{ setView: (v: "front" | "left" | "right" | "back" | "reset") => void } | null>(null);

  useEffect(() => {
    /* detect after mount (no renderer on the server); a one-time post-hydration
       probe is exactly the "effect pinning external-system state" the rule permits
       -- but the probe value also feeds the first render's fallback choice, so this
       mount-only setting must stay synchronous and untouched during hydration. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasWebGL(detectWebGL());
  }, []);

  useEffect(() => {
    /* reset view when the look changes so the user always sees the
       outfit on a fresh front render */
    sceneRef.current?.setView("front");
  }, [garments]);

  const onFatal = useCallback(() => setSceneFailed(true), []);

  const scene = useMemo(
    () =>
      hasWebGL &&
      !sceneFailed && (
        <SceneBoundary fallback={<FallbackPanel garments={garments} />}>
          <Suspense fallback={<FallbackPanel garments={garments} />}>
            <AvatarScene
              ref={sceneRef}
              profile={profile}
              garments={garments}
              className="h-full w-full"
              onFatal={onFatal}
            />
          </Suspense>
        </SceneBoundary>
      ),
    [hasWebGL, sceneFailed, profile, garments, onFatal]
  );

  const fallback = useMemo(
    () => <FallbackPanel garments={garments} />,
    [garments]
  );

  return (
    <div
      className={`relative min-h-[420px] overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-paper-soft to-surface sm:min-h-[500px] ${className ?? ""}`}
      style={style}
    >
      {scene ?? fallback}

      {hasWebGL && !sceneFailed && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-between p-3">
            <p className="rounded-xl bg-ink/70 px-3 py-1.5 text-[11px] text-paper backdrop-blur">
              Drag to rotate · pinch / Ctrl+scroll to zoom
            </p>
          </div>
          <div className="absolute right-3 top-3 z-10 flex gap-1.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => sceneRef.current?.setView(v.id)}
                className="rounded-full bg-ink/80 px-3 py-1.5 text-[11px] font-medium text-paper backdrop-blur transition hover:bg-ink"
              >
                {v.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => sceneRef.current?.setView("reset")}
              className="rounded-full border border-paper/40 px-3 py-1.5 text-[11px] font-medium text-paper backdrop-blur transition hover:bg-ink/80"
            >
              Reset
            </button>
          </div>
        </>
      )}

      <p className="absolute bottom-0 z-10 w-full rounded-b-2xl bg-ink/60 px-4 py-2 text-[10px] text-paper/90 backdrop-blur">
        Structured preview — garments are built from product data, not an
        exact fit.
      </p>
    </div>
  );
}

function AvatarPreview(props: PreviewProps) {
  return <AvatarPreviewInner {...props} />;
}

export default memo(AvatarPreview);