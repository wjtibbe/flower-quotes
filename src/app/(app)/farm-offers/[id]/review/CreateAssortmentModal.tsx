"use client";

import type { OfferLineViewModel } from "./ReviewOfferClient";
import { Modal } from "./Modal";

interface Props {
  line: OfferLineViewModel;
  farmId: string | null;
  farmName: string | null;
  isPending: boolean;
  onClose: () => void;
  onCreate: (formData: FormData) => void;
}

/**
 * "Create assortment item" (sections 11-13): pre-fills every field it can
 * from the offer line, but supplier is fixed to this offer's own farm (never
 * a free-choice input - there is no farm select in this form at all) and
 * every field is required before the server action will create anything.
 * The actual find-or-create + duplicate-safety logic lives entirely
 * server-side (`createAssortmentItemFromOfferLine` ->
 * `findOrCreatePackagingWeightProfile`) - this form only collects input.
 */
export function CreateAssortmentModal({ line, farmId, farmName, isPending, onClose, onCreate }: Props) {
  const defaultStemLength = line.stemLengthCm != null ? `${line.stemLengthCm} cm` : "";

  return (
    <Modal title="Create assortment item" onClose={onClose}>
      {!farmId ? (
        <p className="text-sm text-red-600">
          Deze aanbieding heeft geen leverancier - er kan geen assortimentartikel worden aangemaakt.
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onCreate(new FormData(e.currentTarget));
          }}
        >
          <div>
            <label className="label">Supplier</label>
            <input className="input bg-gray-50" value={farmName ?? ""} disabled readOnly />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Product *</label>
              <input className="input" name="productName" defaultValue={line.productGroupRaw ?? ""} required />
            </div>
            <div>
              <label className="label">Variety *</label>
              <input className="input" name="variety" defaultValue={line.varietyRaw ?? ""} required />
            </div>
            <div>
              <label className="label">Length *</label>
              <input className="input" name="stemLength" defaultValue={defaultStemLength} placeholder="bv. 60 cm" required />
            </div>
            <div>
              <label className="label">Box type *</label>
              <input className="input" name="boxType" defaultValue={line.boxType ?? "QB"} required />
            </div>
            <div>
              <label className="label">Stems per box *</label>
              <input className="input" name="stemsPerBox" type="number" defaultValue={line.stemsPerBox ?? ""} required />
            </div>
            <div>
              <label className="label">Box weight (kg) *</label>
              <input
                className="input"
                name="weightPerBoxKg"
                type="number"
                step="0.001"
                defaultValue={line.weightPerBoxKg ?? ""}
                required
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isPending}>
              Annuleren
            </button>
            <button type="submit" className="btn-primary" disabled={isPending}>
              {isPending ? "Bezig..." : "Create assortment item"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
