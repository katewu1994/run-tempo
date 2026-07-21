import { Gauge, Sparkles, Shuffle } from "lucide-react";
import type { MixPlanStrategy, MixPlanVariant } from "../domain/mixTypes";
import type { MultiTrackCopy } from "./multiTrackFormat";

const ICONS = {
  balanced: Gauge,
  energy: Sparkles,
  variety: Shuffle,
};

export function PlanVariantPicker({
  variants,
  activeVariantId,
  isBusy,
  source,
  copy,
  onSelect,
}: {
  variants: MixPlanVariant[];
  activeVariantId: MixPlanStrategy;
  isBusy: boolean;
  source: "gpt" | "local";
  copy: MultiTrackCopy["variants"];
  onSelect: (variantId: MixPlanStrategy) => void;
}) {
  return (
    <section className="panel planner-panel variant-panel" aria-labelledby="variant-title">
      <div className="panel-heading">
        <div>
          <h2 id="variant-title">{copy.title}</h2>
        </div>
        <span className={`variant-source-badge ${source}`}>
          {copy.sourceLabel} · {copy.sources[source]}
        </span>
      </div>

      <div className="variant-grid" role="radiogroup" aria-label={copy.title}>
        {variants.map((variant) => {
          const Icon = ICONS[variant.variantId];
          const active = activeVariantId === variant.variantId;

          return (
            <button
              type="button"
              role="radio"
              aria-checked={active}
              className={`variant-card ${active ? "active" : ""}`}
              disabled={isBusy}
              key={variant.variantId}
              onClick={() => onSelect(variant.variantId)}
            >
              <span className="variant-icon" aria-hidden="true"><Icon size={20} /></span>
              <span className="variant-copy">
                <strong>{copy.names[variant.variantId]}</strong>
              </span>
              <span className="variant-metrics">
                <span>{copy.unique(variant.summary.uniqueTrackCount)}</span>
                <span>{copy.repeats(variant.summary.repeatCount)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
