"use client";

import { SignerPicker } from "./signer-picker";
import { MOVEMENT_SLOT_VALUES, type MovementSlot } from "@/lib/movement/values";
import { SLOT_LABELS } from "./view-model";

export type SignerPerson = { email: string; name: string };
export type SignerPeople = Record<MovementSlot, SignerPerson | null>;

const HELP: Record<MovementSlot, string> = {
  deployer: "Moves it, starts the deployment and marks it done",
  ba: "Confirms the scope and the checklist",
  lead: "Confirms the risks and the order",
  qa_lead: "Confirms the testing is done and the test evidence",
};

export const EMPTY_SIGNERS: SignerPeople = { deployer: null, ba: null, lead: null, qa_lead: null };

/** A server refusal pinned to the field it is about (400 "The BA (x@y.com) is not a Flux user" names the slot). */
export type SignerErrors = Partial<Record<MovementSlot, string>>;

/** The four signers, one person each (a search over Flux users). All are required, distinct, and existing Flux users. */
export function SignerFields({ deliveryId, value, onChange, errors }: { deliveryId: string; value: SignerPeople; onChange: (next: SignerPeople) => void; errors?: SignerErrors }) {
  return (
    <div className="space-y-2" data-testid="movement-signer-fields">
      {MOVEMENT_SLOT_VALUES.map((slot) => (
        <div key={slot} role="group" aria-label={`${SLOT_LABELS[slot]} signer`} data-testid={`movement-signer-field-${slot}`} className="space-y-0.5">
          <p className="text-xs font-medium">
            {SLOT_LABELS[slot]} <span className="font-normal text-muted-foreground">· {HELP[slot]}</span>
          </p>
          <SignerPicker deliveryId={deliveryId} value={value[slot]} onChange={(p) => onChange({ ...value, [slot]: p })} testId={`movement-signer-picker-${slot}`} />
          {errors?.[slot] && (
            <p role="alert" className="text-[11px] text-destructive" data-testid={`movement-signer-error-${slot}`}>
              {errors[slot]}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export const signersComplete = (v: SignerPeople): boolean => MOVEMENT_SLOT_VALUES.every((s) => !!v[s]?.email);
