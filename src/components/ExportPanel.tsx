import { Download } from "lucide-react";
import type { AppCopy } from "../i18n";

type ExportPanelProps = {
  disabled: boolean;
  fileName: string | null;
  copy: AppCopy["exportPanel"];
  onExport: () => void;
};

export function ExportPanel({
  disabled,
  fileName,
  copy,
  onExport,
}: ExportPanelProps) {
  return (
    <section className="panel export-panel" aria-labelledby="export-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stepLabel}</span>
          <h2 id="export-title">{copy.title}</h2>
        </div>
        <Download aria-hidden="true" />
      </div>

      <div className="export-target">
        <span>{copy.output}</span>
        <strong>{fileName ?? copy.loadAudioFirst}</strong>
      </div>

      <button
        type="button"
        className="primary-action"
        disabled={disabled}
        onClick={onExport}
      >
        <Download size={18} />
        {copy.action}
      </button>
    </section>
  );
}
