/* AvatarConfigurator — "Customize your model" panel.

   Lets the user build the AvatarProfile WITHOUT forcing the
   questionnaire: they pick what they want, hit Apply, and the avatar
   updates everywhere (stored + carried in the URL). Visual-appearance
   properties only (body, skin tone, hair) — never a demographic
   category. */

"use client";

import { memo, useState } from "react";
import {
  AVATAR_GENDERS,
  BODY_SHAPES,
  DEFAULT_AVATAR_PROFILE,
  HAIR_COLORS,
  HAIR_LENGTHS,
  HAIR_STYLES,
  HAIR_TEXTURES,
  SKIN_TONES,
  SKIN_TONE_HEX,
  normalizeAvatarProfile,
  type AvatarProfile,
} from "@/lib/avatar/profile";

type Props = {
  profile: AvatarProfile;
  onApply: (profile: AvatarProfile) => void;
  onCancel: () => void;
};

type OptionRowProps = {
  title: string;
  options: { value: string; label: string }[];
  current: string;
  onPick: (value: string) => void;
  swatch?: (value: string) => string | null;
};

function OptionRow({ title, options, current, onPick, swatch }: OptionRowProps) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.value === current;
          const color = swatch?.(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onPick(o.value)}
              aria-pressed={active}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-accent-deep bg-accent-tint text-ink"
                  : "border-line bg-surface text-ink-soft hover:border-accent/60 hover:text-ink"
              }`}
            >
              {color && (
                <span
                  className="h-3.5 w-3.5 rounded-full border border-ink/10"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
              )}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AvatarConfiguratorInner({ profile, onApply, onCancel }: Props) {
  const [draft, setDraft] = useState<AvatarProfile>({ ...profile });
  const patch = (p: Partial<AvatarProfile>) =>
    setDraft((prev) => normalizeAvatarProfile({ ...prev, ...p }));

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Customize your model"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-paper p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Customize your model</h2>
            <p className="text-xs text-ink-soft">
              Only visual properties — height, body, skin tone, hair. Applied to
              the review avatar right away.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <OptionRow
            title="Gender"
            options={AVATAR_GENDERS}
            current={draft.gender}
            onPick={(v) => patch({ gender: v as AvatarProfile["gender"] })}
          />
          <OptionRow
            title="Body shape"
            options={BODY_SHAPES}
            current={draft.bodyShape}
            onPick={(v) => patch({ bodyShape: v as AvatarProfile["bodyShape"] })}
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-ink-faint">
                Height (cm)
              </span>
              <input
                type="number"
                min={80}
                max={250}
                value={draft.heightCm}
                onChange={(e) => patch({ heightCm: Number(e.target.value) })}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-ink-faint">
                Weight (kg)
              </span>
              <input
                type="number"
                min={25}
                max={300}
                value={draft.weightKg}
                onChange={(e) => patch({ weightKg: Number(e.target.value) })}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-deep"
              />
            </label>
          </div>

          <OptionRow
            title="Skin tone"
            options={SKIN_TONES}
            current={draft.skinTone}
            onPick={(v) => patch({ skinTone: v as AvatarProfile["skinTone"] })}
            swatch={(v) => SKIN_TONE_HEX[v as keyof typeof SKIN_TONE_HEX]}
          />
          <OptionRow
            title="Hair style"
            options={HAIR_STYLES}
            current={draft.hairStyle}
            onPick={(v) => patch({ hairStyle: v as AvatarProfile["hairStyle"] })}
          />
          <OptionRow
            title="Hair length"
            options={HAIR_LENGTHS}
            current={draft.hairLength}
            onPick={(v) => patch({ hairLength: v as AvatarProfile["hairLength"] })}
          />
          <OptionRow
            title="Hair color"
            options={HAIR_COLORS}
            current={draft.hairColor}
            onPick={(v) => patch({ hairColor: v as AvatarProfile["hairColor"] })}
          />
          <OptionRow
            title="Hair texture"
            options={HAIR_TEXTURES}
            current={draft.hairTexture}
            onPick={(v) => patch({ hairTexture: v as AvatarProfile["hairTexture"] })}
          />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="flex-1 rounded-full bg-ink py-2.5 text-sm font-semibold text-paper transition hover:bg-ink-soft"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => onApply(DEFAULT_AVATAR_PROFILE)}
            className="rounded-full border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function AvatarConfigurator(props: Props) {
  return <AvatarConfiguratorInner {...props} />;
}

export default memo(AvatarConfigurator);